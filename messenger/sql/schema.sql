-- =====================================================================
--  LEXI Messenger — схема базы данных (PostgreSQL 15+)
--
--  Принцип: сервер — «слепой» ретранслятор. В базе НЕТ ни одного поля
--  для открытого текста сообщений, тем, профилей или ключей каналов.
--  Хранится только то, что сервер и так видит в сети:
--    • шифротекст AES-256-GCM (с тегом) + nonce (IV, 96 бит);
--    • открытые ключи ML-KEM-768 / ML-DSA-65 (они публичные по определению);
--    • ключи каналов, «завёрнутые» под ML-KEM каждого получателя;
--    • маршрутные метаданные: канал, эпоха, отправитель, время.
--  Пароли — только Argon2id (формат PHC проверяется ограничением).
--  Изоляция данных — Row-Level Security на уровне строк: приложение
--  работает под ролью без BYPASSRLS и видит только каналы пользователя.
--
--  Связь с клиентом (js/lexi-e2e.js):
--    messages.nonce       = env.iv            (12 байт)
--    messages.ciphertext  = env.ct            (ct ‖ tag, тег 16 байт)
--    messages.epoch_id   ↔ env.epoch
--    messages.client_msg_id = env.id          (8 байт)
--    AAD = "LEXI1|канал|эпоха|отправитель|id" — восстанавливается из
--    метаданных строки, отдельно не хранится; подмена любого поля ломает GCM.
-- =====================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS lexi;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA lexi FROM PUBLIC;
-- citext — регистронезависимые позывные; ставим в схему lexi, чтобы
-- функции с фиксированным search_path видели тип и операторы.
-- gen_random_uuid() и sha256() встроены в PostgreSQL 13+ / 11+.
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA lexi;

-- ---------------------------------------------------------------------
--  Роли. Владелец схемы не используется приложением.
--    lexi_app       — рабочая роль сервера (без BYPASSRLS, без DDL)
--    lexi_auth      — роль, через которую идёт только вход (функции SECURITY DEFINER)
--    lexi_retention — фоновая очистка по сроку хранения
--    lexi_auditor   — только чтение журнала аудита
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lexi_app')       THEN CREATE ROLE lexi_app       NOLOGIN NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lexi_retention') THEN CREATE ROLE lexi_retention NOLOGIN NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lexi_auditor')   THEN CREATE ROLE lexi_auditor   NOLOGIN NOBYPASSRLS; END IF;
  -- сотрудники LEXI, которые вручную подтверждают учёных
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lexi_staff')     THEN CREATE ROLE lexi_staff     NOLOGIN NOBYPASSRLS; END IF;
END $$;
-- Логин-роли создаются отдельно: CREATE ROLE lexi_server LOGIN PASSWORD '…' IN ROLE lexi_app;

SET search_path = lexi, pg_catalog;

-- ---------------------------------------------------------------------
--  Типы
-- ---------------------------------------------------------------------
CREATE TYPE lexi.account_status AS ENUM ('active', 'locked', 'deleted');
-- channel — пишут только владелец и модераторы (как канал в Telegram); group — все участники; direct — двое
CREATE TYPE lexi.channel_kind   AS ENUM ('channel', 'group', 'direct');
CREATE TYPE lexi.member_role    AS ENUM ('owner', 'moderator', 'member', 'readonly');
CREATE TYPE lexi.report_status  AS ENUM ('open', 'reviewing', 'closed');

-- ---------------------------------------------------------------------
--  Контекст запроса: кто сейчас действует.
--  Сервер после проверки сессии выполняет в той же транзакции:
--     SELECT set_config('lexi.user_id', '<uuid>', true);
--  Без этого все политики RLS возвращают пустой результат.
-- ---------------------------------------------------------------------
CREATE FUNCTION lexi.current_user_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting('lexi.user_id', true), '')::uuid
$$;

-- =====================================================================
--  1. Пользователи и вход
-- =====================================================================
CREATE TABLE lexi.users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handle           citext NOT NULL UNIQUE
                   CHECK (handle ~ '^[a-z0-9][a-z0-9_.-]{1,23}$'),
  display_name     text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 64),
  -- Только Argon2id в формате PHC: $argon2id$v=19$m=…,t=…,p=…$соль$хеш
  -- Минимальные параметры (OWASP 2024): m ≥ 19456 КиБ, t ≥ 2.
  password_hash    text NOT NULL
                   CHECK (password_hash ~ '^\$argon2id\$v=19\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9+/]{16,}\$[A-Za-z0-9+/]{32,}$'
                          AND substring(password_hash FROM 'm=([0-9]+)')::int >= 19456
                          AND substring(password_hash FROM 't=([0-9]+)')::int >= 2),
  -- Секрет TOTP хранится только зашифрованным ключом из KMS (envelope encryption)
  totp_secret_enc  bytea CHECK (totp_secret_enc IS NULL OR octet_length(totp_secret_enc) BETWEEN 28 AND 128),
  orcid            text CHECK (orcid IS NULL OR orcid ~ '^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$'),
  orcid_verified   boolean NOT NULL DEFAULT false,
  -- Значок «проверенный учёный»: ставит только сотрудник LEXI через lexi.set_scientist()
  verified_scientist boolean NOT NULL DEFAULT false,
  verified_by      uuid REFERENCES lexi.users(id) ON DELETE SET NULL,
  verified_at      timestamptz,
  CHECK (verified_scientist = false OR verified_at IS NOT NULL),
  CHECK (verified_by IS NULL OR verified_by <> id),
  status           lexi.account_status NOT NULL DEFAULT 'active',
  failed_logins    smallint NOT NULL DEFAULT 0 CHECK (failed_logins >= 0),
  locked_until     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_login_at    timestamptz
);
COMMENT ON TABLE lexi.users IS 'Учётные записи. Профиль (роль, организация, «о себе») распространяется E2E-сообщением t=profile и здесь не хранится.';
COMMENT ON COLUMN lexi.users.password_hash IS 'Argon2id (PHC). Проверка выполняется в приложении (argon2-cffi / argon2-browser); столбец недоступен роли lexi_app напрямую.';

CREATE TABLE lexi.devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES lexi.users(id) ON DELETE CASCADE,
  label         text CHECK (label IS NULL OR char_length(label) <= 64),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz,
  revoked_at    timestamptz
);
CREATE INDEX devices_user_idx ON lexi.devices (user_id) WHERE revoked_at IS NULL;

-- Сессии. Токен — 256 случайных бит; в базе только HMAC-SHA-256 с «перцем»
-- из секрет-хранилища сервера. Для токенов с полной энтропией медленный хеш
-- не нужен (подбор невозможен), а HMAC даёт поиск по индексу за O(1).
-- Утечка таблицы без перца не позволяет ни войти, ни проверить токен.
CREATE TABLE lexi.sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES lexi.users(id) ON DELETE CASCADE,
  device_id     uuid REFERENCES lexi.devices(id) ON DELETE CASCADE,
  token_hmac    bytea NOT NULL UNIQUE CHECK (octet_length(token_hmac) = 32),
  transport_kem text NOT NULL DEFAULT 'ML-KEM-768' CHECK (transport_kem IN ('ML-KEM-768', 'ML-KEM-1024', 'X25519+ML-KEM-768')),
  ip_hmac       bytea CHECK (ip_hmac IS NULL OR octet_length(ip_hmac) = 32),  -- IP не храним в открытом виде
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 days')
);
CREATE INDEX sessions_user_idx ON lexi.sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_expiry_idx ON lexi.sessions (expires_at);
COMMENT ON TABLE lexi.sessions IS 'Сеансовый ключ транспорта (ML-KEM → HKDF → AES-GCM) живёт только в памяти сервера и никогда не пишется в базу.';

-- Долгоживущие системные токены (боты-станции, телеметрия): префикс для
-- поиска + секрет, захешированный Argon2id. Показываются один раз при выдаче.
CREATE TABLE lexi.api_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      uuid NOT NULL REFERENCES lexi.users(id) ON DELETE CASCADE,
  token_prefix  text NOT NULL UNIQUE CHECK (token_prefix ~ '^lexi_[a-z0-9]{8}$'),
  secret_hash   text NOT NULL CHECK (secret_hash ~ '^\$argon2id\$v=19\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9+/]{16,}\$[A-Za-z0-9+/]{32,}$'),
  scopes        text[] NOT NULL DEFAULT '{}' CHECK (scopes <@ ARRAY['post', 'read', 'telemetry']::text[]),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz
);

-- =====================================================================
--  2. Открытые ключи участников
--  Секретные ключи ML-KEM / ML-DSA никогда не покидают устройство.
-- =====================================================================
CREATE TABLE lexi.identity_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES lexi.users(id) ON DELETE CASCADE,
  device_id       uuid NOT NULL REFERENCES lexi.devices(id) ON DELETE CASCADE,
  kem_alg         text NOT NULL DEFAULT 'ML-KEM-768' CHECK (kem_alg IN ('ML-KEM-768', 'ML-KEM-1024')),
  kem_public_key  bytea NOT NULL,
  sig_alg         text CHECK (sig_alg IS NULL OR sig_alg IN ('ML-DSA-65', 'ML-DSA-87')),
  sig_public_key  bytea,
  -- Подпись KEM-ключа ключом ML-DSA: сервер не может незаметно подменить ключ
  kem_key_sig     bytea,
  fingerprint     bytea GENERATED ALWAYS AS (sha256(kem_public_key)) STORED,
  created_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  -- Размеры по FIPS 203 / 204
  CHECK ((kem_alg = 'ML-KEM-768' AND octet_length(kem_public_key) = 1184)
      OR (kem_alg = 'ML-KEM-1024' AND octet_length(kem_public_key) = 1568)),
  CHECK (sig_public_key IS NULL
      OR (sig_alg = 'ML-DSA-65' AND octet_length(sig_public_key) = 1952)
      OR (sig_alg = 'ML-DSA-87' AND octet_length(sig_public_key) = 2592)),
  CHECK (kem_key_sig IS NULL OR (sig_alg = 'ML-DSA-65' AND octet_length(kem_key_sig) = 3309)
                             OR (sig_alg = 'ML-DSA-87' AND octet_length(kem_key_sig) = 4627))
);
-- Один действующий ключ на устройство
CREATE UNIQUE INDEX identity_keys_active_uq ON lexi.identity_keys (device_id) WHERE revoked_at IS NULL;
CREATE INDEX identity_keys_user_idx ON lexi.identity_keys (user_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX identity_keys_fp_uq ON lexi.identity_keys (fingerprint);

-- =====================================================================
--  3. Каналы и участники
-- =====================================================================
CREATE TABLE lexi.channels (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Для личных каналов slug = 'dm-' + хеш пары uid, имена людей не раскрываются
  slug          citext NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  kind          lexi.channel_kind NOT NULL DEFAULT 'group',
  is_public     boolean NOT NULL DEFAULT false,      -- публичный = можно вступить без приглашения
  premoderation boolean NOT NULL DEFAULT false,      -- флаг для клиентов; содержимое сервер не видит
  retention     interval NOT NULL DEFAULT interval '365 days' CHECK (retention BETWEEN interval '1 day' AND interval '10 years'),
  created_by    uuid REFERENCES lexi.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'direct' OR (is_public = false AND slug ~ '^dm-'))
);
COMMENT ON TABLE lexi.channels IS 'Тема канала НЕ хранится: она передаётся зашифрованным сообщением t=topic.';

CREATE TABLE lexi.channel_members (
  channel_id   uuid NOT NULL REFERENCES lexi.channels(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES lexi.users(id) ON DELETE CASCADE,
  role         lexi.member_role NOT NULL DEFAULT 'member',
  joined_at    timestamptz NOT NULL DEFAULT now(),
  left_at      timestamptz,
  PRIMARY KEY (channel_id, user_id),
  CHECK (left_at IS NULL OR left_at >= joined_at)
);
CREATE INDEX channel_members_user_idx ON lexi.channel_members (user_id) WHERE left_at IS NULL;

-- Активное членство: основа всех политик RLS
CREATE FUNCTION lexi.is_member(p_channel uuid, p_user uuid DEFAULT lexi.current_user_id()) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = lexi, pg_catalog AS $$
  SELECT EXISTS (SELECT 1 FROM lexi.channel_members m
                 WHERE m.channel_id = p_channel AND m.user_id = p_user AND m.left_at IS NULL)
$$;
CREATE FUNCTION lexi.member_role_of(p_channel uuid, p_user uuid DEFAULT lexi.current_user_id()) RETURNS lexi.member_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = lexi, pg_catalog AS $$
  SELECT m.role FROM lexi.channel_members m
  WHERE m.channel_id = p_channel AND m.user_id = p_user AND m.left_at IS NULL
$$;

-- Свойства канала для политик (вне RLS самого канала: вступающий ещё не участник)
CREATE FUNCTION lexi.channel_is_public(p_channel uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = lexi, pg_catalog AS $$
  SELECT coalesce((SELECT is_public FROM lexi.channels WHERE id = p_channel), false)
$$;
CREATE FUNCTION lexi.channel_created_by(p_channel uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = lexi, pg_catalog AS $$
  SELECT created_by FROM lexi.channels WHERE id = p_channel
$$;
CREATE FUNCTION lexi.channel_kind_of(p_channel uuid) RETURNS lexi.channel_kind
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = lexi, pg_catalog AS $$
  SELECT kind FROM lexi.channels WHERE id = p_channel
$$;
-- Кто может писать: в канале — владелец и модераторы, в группе и личке — любой участник, кроме readonly
CREATE FUNCTION lexi.can_post(p_channel uuid, p_user uuid DEFAULT lexi.current_user_id()) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = lexi, pg_catalog AS $$
  SELECT CASE lexi.channel_kind_of(p_channel)
           WHEN 'channel' THEN lexi.member_role_of(p_channel, p_user) IN ('owner', 'moderator')
           ELSE lexi.member_role_of(p_channel, p_user) IN ('owner', 'moderator', 'member')
         END IS TRUE
$$;

-- =====================================================================
--  4. Эпохи ключей канала и «завёрнутые» ключи
--  Сам ключ эпохи (32 байта) в базе отсутствует в любом виде.
-- =====================================================================
CREATE TABLE lexi.channel_epochs (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  channel_id   uuid NOT NULL REFERENCES lexi.channels(id) ON DELETE CASCADE,
  epoch_label  text NOT NULL CHECK (epoch_label ~ '^[0-9a-z]{9}-[0-9a-f]{6}$'),   -- как в клиенте: время36-случайное
  created_by   uuid REFERENCES lexi.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  retired_at   timestamptz,                    -- ротация при выходе участника
  UNIQUE (channel_id, epoch_label)
);

CREATE TABLE lexi.key_shares (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  epoch_id         bigint NOT NULL REFERENCES lexi.channel_epochs(id) ON DELETE CASCADE,
  recipient_key_id uuid NOT NULL REFERENCES lexi.identity_keys(id) ON DELETE CASCADE,
  sender_key_id    uuid NOT NULL REFERENCES lexi.identity_keys(id) ON DELETE CASCADE,
  kem_ciphertext   bytea NOT NULL CHECK (octet_length(kem_ciphertext) IN (1088, 1568)),  -- ML-KEM-768 / 1024
  wrap_nonce       bytea NOT NULL CHECK (octet_length(wrap_nonce) = 12),
  wrapped_key      bytea NOT NULL CHECK (octet_length(wrapped_key) = 48),               -- 32 Б ключа + 16 Б тега GCM
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (epoch_id, recipient_key_id)
);
CREATE INDEX key_shares_recipient_idx ON lexi.key_shares (recipient_key_id);

-- =====================================================================
--  5. Сообщения — только шифротекст
-- =====================================================================
CREATE TABLE lexi.messages (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,    -- курсор для истории
  channel_id      uuid NOT NULL REFERENCES lexi.channels(id) ON DELETE CASCADE,
  epoch_id        bigint NOT NULL REFERENCES lexi.channel_epochs(id) ON DELETE RESTRICT,
  sender_id       uuid REFERENCES lexi.users(id) ON DELETE SET NULL,
  sender_key_id   uuid REFERENCES lexi.identity_keys(id) ON DELETE SET NULL,
  client_msg_id   bytea NOT NULL CHECK (octet_length(client_msg_id) = 8),
  aead_alg        text NOT NULL DEFAULT 'AES-256-GCM' CHECK (aead_alg IN ('AES-256-GCM')),
  nonce           bytea NOT NULL CHECK (octet_length(nonce) = 12),            -- IV 96 бит
  ciphertext      bytea NOT NULL CHECK (octet_length(ciphertext) BETWEEN 17 AND 6291456), -- ≥ 1 Б + 16 Б тега, ≤ 6 МБ
  received_at     timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  UNIQUE (channel_id, sender_id, client_msg_id),       -- повторная доставка не создаёт дубль
  -- Повтор nonce под тем же ключом ломает GCM: база отвергает такую запись
  UNIQUE (epoch_id, nonce)
);
COMMENT ON TABLE lexi.messages IS 'Нет столбцов для текста. Тип содержимого (текст, правка, реакция, голос, опрос) скрыт внутри шифротекста.';
CREATE INDEX messages_history_idx ON lexi.messages (channel_id, id DESC);
CREATE INDEX messages_expiry_brin ON lexi.messages USING brin (expires_at);
CREATE INDEX messages_sender_idx ON lexi.messages (sender_id);

-- Срок хранения берётся из настроек канала
CREATE FUNCTION lexi.messages_defaults() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = lexi, pg_catalog AS $$
DECLARE
  v_ret interval;
  v_epoch_channel uuid;
BEGIN
  SELECT retention INTO v_ret FROM lexi.channels WHERE id = NEW.channel_id;
  NEW.received_at := now();
  NEW.expires_at  := now() + coalesce(v_ret, interval '365 days');
  -- эпоха должна принадлежать тому же каналу и быть действующей
  SELECT channel_id INTO v_epoch_channel FROM lexi.channel_epochs WHERE id = NEW.epoch_id AND retired_at IS NULL;
  IF v_epoch_channel IS DISTINCT FROM NEW.channel_id THEN
    RAISE EXCEPTION 'epoch % does not belong to channel or is retired', NEW.epoch_id USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER messages_defaults BEFORE INSERT ON lexi.messages
  FOR EACH ROW EXECUTE FUNCTION lexi.messages_defaults();

-- Сообщения неизменяемы: правки и удаления — это новые зашифрованные события
CREATE FUNCTION lexi.forbid_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;
CREATE TRIGGER messages_immutable BEFORE UPDATE ON lexi.messages
  FOR EACH ROW EXECUTE FUNCTION lexi.forbid_change();

-- Вложения (FITS, изображения) — зашифрованные блобы во внешнем хранилище.
-- Ключ вложения лежит внутри зашифрованного сообщения.
CREATE TABLE lexi.attachments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id        bigint NOT NULL REFERENCES lexi.messages(id) ON DELETE CASCADE,
  storage_key       text NOT NULL UNIQUE CHECK (storage_key ~ '^blobs/[0-9a-f]{64}$'),  -- имя = SHA-256 шифротекста
  nonce             bytea NOT NULL CHECK (octet_length(nonce) = 12),
  ciphertext_sha256 bytea NOT NULL CHECK (octet_length(ciphertext_sha256) = 32),
  byte_size         bigint NOT NULL CHECK (byte_size BETWEEN 17 AND 268435456),     -- до 256 МБ (большие FITS)
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachments_message_idx ON lexi.attachments (message_id);

-- =====================================================================
--  6. Жалобы и журнал аудита
-- =====================================================================
-- Сервер не видит содержимое, поэтому жалоба может приложить фрагмент,
-- зашифрованный под ключ модераторов (ML-KEM), — по желанию заявителя.
CREATE TABLE lexi.abuse_reports (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reporter_id        uuid REFERENCES lexi.users(id) ON DELETE SET NULL,
  message_id         bigint REFERENCES lexi.messages(id) ON DELETE SET NULL,
  reason             text NOT NULL CHECK (reason IN ('spam', 'abuse', 'impersonation', 'malware', 'other')),
  evidence_kem_ct    bytea CHECK (evidence_kem_ct IS NULL OR octet_length(evidence_kem_ct) IN (1088, 1568)),
  evidence_nonce     bytea CHECK (evidence_nonce IS NULL OR octet_length(evidence_nonce) = 12),
  evidence_ciphertext bytea CHECK (evidence_ciphertext IS NULL OR octet_length(evidence_ciphertext) <= 65536),
  status             lexi.report_status NOT NULL DEFAULT 'open',
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK ((evidence_ciphertext IS NULL) = (evidence_nonce IS NULL) AND (evidence_ciphertext IS NULL) = (evidence_kem_ct IS NULL))
);

-- Журнал с хеш-цепочкой: любое изменение прошлой записи ломает цепочку.
CREATE TABLE lexi.audit_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_id   uuid,
  action     text NOT NULL CHECK (action ~ '^[a-z_.]{3,48}$'),
  target     text,
  details    jsonb NOT NULL DEFAULT '{}'::jsonb
             CHECK (NOT (details ?| ARRAY['password', 'password_hash', 'token', 'secret', 'plaintext', 'content'])),
  prev_hash  bytea,
  row_hash   bytea NOT NULL
);
CREATE INDEX audit_log_actor_idx ON lexi.audit_log (actor_id, at DESC);

CREATE FUNCTION lexi.audit_chain() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = lexi, pg_catalog AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('lexi.audit_log'));    -- строгий порядок цепочки
  SELECT row_hash INTO NEW.prev_hash FROM lexi.audit_log ORDER BY id DESC LIMIT 1;
  NEW.at := clock_timestamp();
  NEW.row_hash := sha256(convert_to(
      coalesce(encode(NEW.prev_hash, 'hex'), '') || '|' || NEW.at::text || '|' ||
      coalesce(NEW.actor_id::text, '') || '|' || NEW.action || '|' || coalesce(NEW.target, '') || '|' || NEW.details::text, 'UTF8'));
  RETURN NEW;
END $$;
CREATE TRIGGER audit_chain BEFORE INSERT ON lexi.audit_log FOR EACH ROW EXECUTE FUNCTION lexi.audit_chain();
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON lexi.audit_log FOR EACH ROW EXECUTE FUNCTION lexi.forbid_change();

CREATE FUNCTION lexi.audit(p_action text, p_target text, p_details jsonb DEFAULT '{}'::jsonb) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = lexi, pg_catalog AS $$
  INSERT INTO lexi.audit_log (actor_id, action, target, details) VALUES (lexi.current_user_id(), p_action, p_target, p_details)
$$;

-- =====================================================================
--  7. Вход: доступ к хешу пароля только через узкие функции
-- =====================================================================
-- Возвращает хеш для проверки Argon2id в приложении; заблокированных не отдаёт.
CREATE FUNCTION lexi.auth_lookup(p_handle citext)
RETURNS TABLE (user_id uuid, password_hash text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = lexi, pg_catalog AS $$
  SELECT u.id, u.password_hash FROM lexi.users u
  WHERE u.handle = p_handle AND u.status = 'active' AND (u.locked_until IS NULL OR u.locked_until < now())
$$;

-- Результат проверки: счётчик неудач и временная блокировка (5 попыток → 15 мин)
CREATE FUNCTION lexi.auth_result(p_user uuid, p_ok boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = lexi, pg_catalog AS $$
BEGIN
  IF p_ok THEN
    UPDATE lexi.users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = p_user;
  ELSE
    UPDATE lexi.users SET failed_logins = failed_logins + 1,
           locked_until = CASE WHEN failed_logins + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END
    WHERE id = p_user;
  END IF;
  INSERT INTO lexi.audit_log (actor_id, action, target) VALUES (p_user, CASE WHEN p_ok THEN 'auth.ok' ELSE 'auth.fail' END, p_user::text);
END $$;

-- Смена пароля: новый хеш тоже проходит CHECK формата Argon2id
CREATE FUNCTION lexi.set_password_hash(p_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = lexi, pg_catalog AS $$
BEGIN
  UPDATE lexi.users SET password_hash = p_hash WHERE id = lexi.current_user_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'no current user' USING ERRCODE = '42501'; END IF;
  INSERT INTO lexi.audit_log (actor_id, action, target) VALUES (lexi.current_user_id(), 'auth.password_changed', lexi.current_user_id()::text);
END $$;

-- Подтверждение учёного: только роль lexi_staff, каждое действие пишется в журнал
CREATE FUNCTION lexi.set_scientist(p_user uuid, p_on boolean, p_note text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = lexi, pg_catalog AS $$
BEGIN
  -- вызвать может только lexi_staff (GRANT EXECUTE ниже); приложение этого права не имеет
  IF p_user = lexi.current_user_id() THEN RAISE EXCEPTION 'self-verification' USING ERRCODE = '42501'; END IF;
  UPDATE lexi.users SET verified_scientist = p_on,
                        verified_by = CASE WHEN p_on THEN lexi.current_user_id() END,
                        verified_at = CASE WHEN p_on THEN now() END
  WHERE id = p_user AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'no such active user'; END IF;
  INSERT INTO lexi.audit_log (actor_id, action, target, details)
  VALUES (lexi.current_user_id(), CASE WHEN p_on THEN 'staff.verify' ELSE 'staff.unverify' END, p_user::text,
          jsonb_build_object('note', left(coalesce(p_note, ''), 200)));
END $$;

-- Публичный справочник без секретов
CREATE VIEW lexi.user_directory WITH (security_barrier = true) AS
  SELECT id, handle, display_name, orcid_verified, verified_scientist FROM lexi.users WHERE status = 'active';

-- =====================================================================
--  8. Row-Level Security
--  FORCE — политики действуют и для владельца таблиц (кроме суперпользователя).
-- =====================================================================
ALTER TABLE lexi.users           ENABLE ROW LEVEL SECURITY; ALTER TABLE lexi.users           FORCE ROW LEVEL SECURITY;
ALTER TABLE lexi.devices         ENABLE ROW LEVEL SECURITY; ALTER TABLE lexi.devices         FORCE ROW LEVEL SECURITY;
ALTER TABLE lexi.sessions        ENABLE ROW LEVEL SECURITY; ALTER TABLE lexi.sessions        FORCE ROW LEVEL SECURITY;
ALTER TABLE lexi.api_tokens      ENABLE ROW LEVEL SECURITY; ALTER TABLE lexi.api_tokens      FORCE ROW LEVEL SECURITY;
ALTER TABLE lexi.identity_keys   ENABLE ROW LEVEL SECURITY; ALTER TABLE lexi.identity_keys   FORCE ROW LEVEL SECURITY;
ALTER TABLE lexi.channels        ENABLE ROW LEVEL SECURITY; ALTER TABLE lexi.channels        FORCE ROW LEVEL SECURITY;
ALTER TABLE lexi.channel_members ENABLE ROW LEVEL SECURITY; ALTER TABLE lexi.channel_members FORCE ROW LEVEL SECURITY;
ALTER TABLE lexi.channel_epochs  ENABLE ROW LEVEL SECURITY; ALTER TABLE lexi.channel_epochs  FORCE ROW LEVEL SECURITY;
ALTER TABLE lexi.key_shares      ENABLE ROW LEVEL SECURITY; ALTER TABLE lexi.key_shares      FORCE ROW LEVEL SECURITY;
ALTER TABLE lexi.messages        ENABLE ROW LEVEL SECURITY; ALTER TABLE lexi.messages        FORCE ROW LEVEL SECURITY;
ALTER TABLE lexi.attachments     ENABLE ROW LEVEL SECURITY; ALTER TABLE lexi.attachments     FORCE ROW LEVEL SECURITY;
ALTER TABLE lexi.abuse_reports   ENABLE ROW LEVEL SECURITY; ALTER TABLE lexi.abuse_reports   FORCE ROW LEVEL SECURITY;
ALTER TABLE lexi.audit_log       ENABLE ROW LEVEL SECURITY; ALTER TABLE lexi.audit_log       FORCE ROW LEVEL SECURITY;

-- users: свою строку видно целиком (кроме недоступных по grant столбцов), чужие — через user_directory
CREATE POLICY users_self ON lexi.users FOR SELECT TO lexi_app USING (id = lexi.current_user_id());
CREATE POLICY users_self_upd ON lexi.users FOR UPDATE TO lexi_app USING (id = lexi.current_user_id()) WITH CHECK (id = lexi.current_user_id());

CREATE POLICY devices_own ON lexi.devices FOR ALL TO lexi_app
  USING (user_id = lexi.current_user_id()) WITH CHECK (user_id = lexi.current_user_id());
CREATE POLICY sessions_own ON lexi.sessions FOR ALL TO lexi_app
  USING (user_id = lexi.current_user_id()) WITH CHECK (user_id = lexi.current_user_id());
CREATE POLICY tokens_own ON lexi.api_tokens FOR ALL TO lexi_app
  USING (owner_id = lexi.current_user_id()) WITH CHECK (owner_id = lexi.current_user_id());

-- Открытые ключи публичны для вошедших; добавлять — только свои
CREATE POLICY ikeys_read ON lexi.identity_keys FOR SELECT TO lexi_app USING (lexi.current_user_id() IS NOT NULL);
CREATE POLICY ikeys_add ON lexi.identity_keys FOR INSERT TO lexi_app WITH CHECK (user_id = lexi.current_user_id());
CREATE POLICY ikeys_revoke ON lexi.identity_keys FOR UPDATE TO lexi_app
  USING (user_id = lexi.current_user_id()) WITH CHECK (user_id = lexi.current_user_id());

-- Каналы: виден, если вы участник или он публичный
CREATE POLICY channels_read ON lexi.channels FOR SELECT TO lexi_app
  USING (is_public OR lexi.is_member(id));
CREATE POLICY channels_create ON lexi.channels FOR INSERT TO lexi_app
  WITH CHECK (created_by = lexi.current_user_id());
CREATE POLICY channels_admin ON lexi.channels FOR UPDATE TO lexi_app
  USING (lexi.member_role_of(id) = 'owner') WITH CHECK (lexi.member_role_of(id) = 'owner');

-- Участники: видны участникам того же канала
CREATE POLICY members_read ON lexi.channel_members FOR SELECT TO lexi_app
  USING (lexi.is_member(channel_id));
-- Вступить самому в публичный канал; создатель становится владельцем;
-- владелец и модераторы добавляют других (в т.ч. в личные каналы)
CREATE POLICY members_join ON lexi.channel_members FOR INSERT TO lexi_app
  WITH CHECK (
    (user_id = lexi.current_user_id() AND role = 'member'
       AND lexi.channel_is_public(channel_id))
    OR (user_id = lexi.current_user_id() AND role = 'owner'
       AND lexi.channel_created_by(channel_id) = lexi.current_user_id()
       AND NOT EXISTS (SELECT 1 FROM lexi.channel_members x WHERE x.channel_id = channel_members.channel_id AND x.role = 'owner'))
    OR (lexi.member_role_of(channel_id) IN ('owner', 'moderator') AND role IN ('member', 'readonly'))
  );
CREATE POLICY members_leave ON lexi.channel_members FOR UPDATE TO lexi_app
  USING (user_id = lexi.current_user_id() OR lexi.member_role_of(channel_id) IN ('owner', 'moderator'))
  WITH CHECK (user_id = lexi.current_user_id() OR lexi.member_role_of(channel_id) IN ('owner', 'moderator'));

-- Эпохи: видят и создают участники
CREATE POLICY epochs_read ON lexi.channel_epochs FOR SELECT TO lexi_app USING (lexi.is_member(channel_id));
CREATE POLICY epochs_add ON lexi.channel_epochs FOR INSERT TO lexi_app
  WITH CHECK (lexi.is_member(channel_id) AND created_by = lexi.current_user_id());

-- Завёрнутые ключи: получатель видит свои, отправитель — участник канала со своим ключом
CREATE POLICY shares_read ON lexi.key_shares FOR SELECT TO lexi_app
  USING (EXISTS (SELECT 1 FROM lexi.identity_keys k WHERE k.id = recipient_key_id AND k.user_id = lexi.current_user_id())
      OR EXISTS (SELECT 1 FROM lexi.identity_keys k WHERE k.id = sender_key_id AND k.user_id = lexi.current_user_id()));
CREATE POLICY shares_add ON lexi.key_shares FOR INSERT TO lexi_app
  WITH CHECK (EXISTS (SELECT 1 FROM lexi.identity_keys k WHERE k.id = sender_key_id AND k.user_id = lexi.current_user_id() AND k.revoked_at IS NULL)
          AND EXISTS (SELECT 1 FROM lexi.channel_epochs e WHERE e.id = epoch_id AND lexi.is_member(e.channel_id)));

-- Сообщения: читать — участникам; писать — участнику (не readonly) от своего имени и своим ключом
CREATE POLICY messages_read ON lexi.messages FOR SELECT TO lexi_app USING (lexi.is_member(channel_id));
CREATE POLICY messages_write ON lexi.messages FOR INSERT TO lexi_app
  WITH CHECK (sender_id = lexi.current_user_id()
          AND lexi.can_post(channel_id)
          AND EXISTS (SELECT 1 FROM lexi.identity_keys k WHERE k.id = sender_key_id AND k.user_id = lexi.current_user_id() AND k.revoked_at IS NULL));
-- Очистка по сроку — только у роли retention
CREATE POLICY messages_purge ON lexi.messages FOR DELETE TO lexi_retention USING (expires_at < now());
CREATE POLICY messages_purge_read ON lexi.messages FOR SELECT TO lexi_retention USING (expires_at < now());

CREATE POLICY att_read ON lexi.attachments FOR SELECT TO lexi_app
  USING (EXISTS (SELECT 1 FROM lexi.messages m WHERE m.id = message_id));        -- RLS сообщений уже отфильтровал
CREATE POLICY att_add ON lexi.attachments FOR INSERT TO lexi_app
  WITH CHECK (EXISTS (SELECT 1 FROM lexi.messages m WHERE m.id = message_id AND m.sender_id = lexi.current_user_id()));

CREATE POLICY reports_add ON lexi.abuse_reports FOR INSERT TO lexi_app WITH CHECK (reporter_id = lexi.current_user_id());
CREATE POLICY reports_own ON lexi.abuse_reports FOR SELECT TO lexi_app USING (reporter_id = lexi.current_user_id());

CREATE POLICY audit_read ON lexi.audit_log FOR SELECT TO lexi_auditor USING (true);

-- =====================================================================
--  9. Привилегии (минимально необходимые)
-- =====================================================================
GRANT USAGE ON SCHEMA lexi TO lexi_app, lexi_retention, lexi_auditor;

-- users: password_hash и totp_secret_enc роли приложения недоступны вовсе
GRANT SELECT (id, handle, display_name, orcid, orcid_verified, verified_scientist, verified_at, status, created_at, last_login_at) ON lexi.users TO lexi_app;
GRANT UPDATE (display_name, orcid) ON lexi.users TO lexi_app;
GRANT SELECT ON lexi.user_directory TO lexi_app;

GRANT SELECT, INSERT, UPDATE (label, last_seen_at, revoked_at) ON lexi.devices TO lexi_app;
GRANT SELECT, INSERT, UPDATE (revoked_at) ON lexi.sessions TO lexi_app;
GRANT SELECT (id, owner_id, token_prefix, scopes, created_at, expires_at, revoked_at), INSERT, UPDATE (revoked_at) ON lexi.api_tokens TO lexi_app;
GRANT SELECT, INSERT, UPDATE (revoked_at) ON lexi.identity_keys TO lexi_app;
GRANT SELECT, INSERT, UPDATE (is_public, premoderation, retention) ON lexi.channels TO lexi_app;
GRANT SELECT, INSERT, UPDATE (role, left_at) ON lexi.channel_members TO lexi_app;
GRANT SELECT, INSERT, UPDATE (retired_at) ON lexi.channel_epochs TO lexi_app;
GRANT SELECT, INSERT ON lexi.key_shares TO lexi_app;
GRANT SELECT, INSERT ON lexi.messages TO lexi_app;            -- без UPDATE и DELETE
GRANT SELECT, INSERT ON lexi.attachments TO lexi_app;
GRANT SELECT, INSERT ON lexi.abuse_reports TO lexi_app;
GRANT SELECT, DELETE ON lexi.messages TO lexi_retention;
GRANT SELECT ON lexi.audit_log TO lexi_auditor;

REVOKE ALL ON FUNCTION lexi.auth_lookup(citext), lexi.auth_result(uuid, boolean), lexi.set_password_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lexi.auth_lookup(citext), lexi.auth_result(uuid, boolean), lexi.set_password_hash(text) TO lexi_app;
GRANT EXECUTE ON FUNCTION lexi.current_user_id(), lexi.is_member(uuid, uuid), lexi.member_role_of(uuid, uuid), lexi.channel_is_public(uuid), lexi.channel_created_by(uuid), lexi.channel_kind_of(uuid), lexi.can_post(uuid, uuid), lexi.audit(text, text, jsonb) TO lexi_app;
REVOKE ALL ON FUNCTION lexi.set_scientist(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lexi.set_scientist(uuid, boolean, text) TO lexi_staff;
GRANT USAGE ON SCHEMA lexi TO lexi_staff;

-- =====================================================================
--  10. Обслуживание
-- =====================================================================
-- Запускать по расписанию от роли lexi_retention: удаляет истёкший шифротекст партиями
CREATE FUNCTION lexi.purge_expired(p_batch int DEFAULT 5000) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  DELETE FROM lexi.messages WHERE id IN (
    SELECT id FROM lexi.messages WHERE expires_at < now() ORDER BY expires_at LIMIT p_batch);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION lexi.purge_expired(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lexi.purge_expired(int) TO lexi_retention;

-- История канала с курсором (для server v2: кадр {type:'history'})
CREATE FUNCTION lexi.channel_history(p_channel uuid, p_before bigint DEFAULT NULL, p_limit int DEFAULT 200)
RETURNS TABLE (id bigint, epoch_label text, sender_id uuid, client_msg_id bytea, nonce bytea, ciphertext bytea, received_at timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT m.id, e.epoch_label, m.sender_id, m.client_msg_id, m.nonce, m.ciphertext, m.received_at
  FROM lexi.messages m JOIN lexi.channel_epochs e ON e.id = m.epoch_id
  WHERE m.channel_id = p_channel AND (p_before IS NULL OR m.id < p_before)
  ORDER BY m.id DESC LIMIT least(p_limit, 500)
$$;   -- SECURITY INVOKER: RLS вызывающего действует
GRANT EXECUTE ON FUNCTION lexi.channel_history(uuid, bigint, int) TO lexi_app;

COMMIT;

-- =====================================================================
--  Что ещё включить на уровне сервера БД (вне DDL):
--   • ssl = on, ssl_min_protocol_version = 'TLSv1.3'; в pg_hba — только hostssl + scram-sha-256;
--   • шифрование томов/бэкапов (LUKS / KMS облака), отдельный ключ для бэкапов;
--   • pgaudit для DDL и ролей; statement_timeout и idle_in_transaction_session_timeout для lexi_app;
--   • перец для HMAC токенов и IP — в секрет-хранилище, не в базе и не в репозитории.
-- =====================================================================
