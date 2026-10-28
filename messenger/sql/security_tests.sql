-- =====================================================================
--  Проверки безопасности схемы. Запуск (суперпользователь, чистая база):
--    psql -d lexi -v ON_ERROR_STOP=1 -f schema.sql -f security_tests.sql
--  Каждый блок либо проходит, либо прерывает скрипт с понятной ошибкой.
-- =====================================================================
\set ON_ERROR_STOP 1
SET search_path = lexi, pg_catalog;

CREATE OR REPLACE FUNCTION pg_temp.expect_error(p_sql text, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'OK  %: отклонено (%)', p_what, SQLERRM; RETURN; END;
  RAISE EXCEPTION 'FAIL %: запрос прошёл, а не должен был', p_what;
END $$;

-- Пользователи (хеши Argon2id m=19456 t=2 сгенерированы argon2-cffi)
INSERT INTO users (id, handle, display_name, password_hash) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'arsen', 'Арсений', '$argon2id$v=19$m=19456,t=2,p=1$z2PLOcdKABiRs2JSF/Hh8Q$/as1CHFiKccZvZEEIu8satoSeb7vZmqByjLn5D9DM8I'),
  ('00000000-0000-0000-0000-00000000000b', 'gosha', 'Георгий', '$argon2id$v=19$m=19456,t=2,p=1$zdQzBdVBABJ76hXpzdQBoQ$E/VOb/fqCXGa4rw1I9U3Kh5veunUiBu2YMHL/eX0q8E');
SELECT pg_temp.expect_error($q$INSERT INTO users (handle, display_name, password_hash) VALUES ('x1','X','plaintext-password')$q$, 'пароль открытым текстом');
SELECT pg_temp.expect_error($q$INSERT INTO users (handle, display_name, password_hash) VALUES ('x2','X','$2b$12$abcdefghijklmnopqrstuuvwxyzABCDEFGHIJKLMNOPQRSTUVWXY')$q$, 'bcrypt вместо Argon2id');
SELECT pg_temp.expect_error($q$INSERT INTO users (handle, display_name, password_hash) VALUES ('x3','X','$argon2id$v=19$m=4096,t=1,p=4$3XeR57b+UkAPW2eybyIxAA$zQOles+2n8MFmu3s2CHngh3w9Ca+y3ZqlCRYncAwjW4')$q$, 'Argon2id со слабыми параметрами');

INSERT INTO devices (id, user_id) VALUES ('00000000-0000-0000-0000-0000000000da', '00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-0000000000db', '00000000-0000-0000-0000-00000000000b');

-- ---------- дальше всё от имени приложения ----------
SET ROLE lexi_app;
SELECT set_config('lexi.user_id', '00000000-0000-0000-0000-00000000000a', false);

SELECT pg_temp.expect_error('SELECT password_hash FROM lexi.users', 'роль приложения читает хеш пароля');
INSERT INTO identity_keys (id, user_id, device_id, kem_public_key)
  VALUES ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000da', decode(repeat('ab', 1184), 'hex'));
SELECT pg_temp.expect_error($q$INSERT INTO lexi.identity_keys (user_id, device_id, kem_public_key) VALUES ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000da', decode(repeat('ab', 32), 'hex'))$q$, 'ключ 32 Б вместо 1184 (как в server.py)');
SELECT pg_temp.expect_error($q$INSERT INTO lexi.identity_keys (user_id, device_id, kem_public_key) VALUES ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000db', decode(repeat('cd', 1184), 'hex'))$q$, 'регистрация ключа за другого пользователя');

INSERT INTO channels (id, slug, is_public, created_by) VALUES ('00000000-0000-0000-0000-0000000000c1', 'orbit-calculations', false, '00000000-0000-0000-0000-00000000000a');
INSERT INTO channel_members (channel_id, user_id, role) VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000a', 'owner');
INSERT INTO channel_epochs (channel_id, epoch_label, created_by) VALUES ('00000000-0000-0000-0000-0000000000c1', '0mvplopta-683447', '00000000-0000-0000-0000-00000000000a');

INSERT INTO messages (channel_id, epoch_id, sender_id, sender_key_id, client_msg_id, nonce, ciphertext)
  SELECT '00000000-0000-0000-0000-0000000000c1', e.id, '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000aa',
         decode('23b316fa85ed2717', 'hex'), decode('00112233445566778899aabb', 'hex'), decode(repeat('5a', 64), 'hex')
  FROM channel_epochs e WHERE e.epoch_label = '0mvplopta-683447';
DO $$ BEGIN IF (SELECT count(*) FROM lexi.messages) <> 1 THEN RAISE EXCEPTION 'FAIL участник не видит своё сообщение'; END IF; RAISE NOTICE 'OK  участник видит сообщение канала'; END $$;

SELECT pg_temp.expect_error($q$INSERT INTO lexi.messages (channel_id, epoch_id, sender_id, sender_key_id, client_msg_id, nonce, ciphertext) SELECT channel_id, id, '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000aa', decode('0000000000000001','hex'), decode('00112233445566778899aabb','hex'), decode(repeat('5b',64),'hex') FROM lexi.channel_epochs$q$, 'повтор nonce под той же эпохой (ломает GCM)');
SELECT pg_temp.expect_error($q$INSERT INTO lexi.messages (channel_id, epoch_id, sender_id, sender_key_id, client_msg_id, nonce, ciphertext) SELECT channel_id, id, '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000aa', decode('0000000000000002','hex'), decode('00112233','hex'), decode(repeat('5b',64),'hex') FROM lexi.channel_epochs$q$, 'nonce не 96 бит');
SELECT pg_temp.expect_error($q$INSERT INTO lexi.messages (channel_id, epoch_id, sender_id, sender_key_id, client_msg_id, nonce, ciphertext) SELECT channel_id, id, '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000aa', decode('0000000000000003','hex'), decode('ffffffffffffffffffffffff','hex'), decode(repeat('5b',64),'hex') FROM lexi.channel_epochs$q$, 'сообщение от чужого имени');
SELECT pg_temp.expect_error($q$UPDATE lexi.messages SET ciphertext = decode(repeat('00',64),'hex')$q$, 'изменение шифротекста задним числом');
SELECT pg_temp.expect_error($q$DELETE FROM lexi.messages$q$, 'удаление сообщений ролью приложения');

-- ---------- второй пользователь, не участник ----------
SELECT set_config('lexi.user_id', '00000000-0000-0000-0000-00000000000b', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM lexi.messages) <> 0 THEN RAISE EXCEPTION 'FAIL чужой видит шифротекст канала'; END IF;
  IF (SELECT count(*) FROM lexi.channels) <> 0 THEN RAISE EXCEPTION 'FAIL чужой видит закрытый канал'; END IF;
  IF (SELECT count(*) FROM lexi.channel_members) <> 0 THEN RAISE EXCEPTION 'FAIL чужой видит состав канала'; END IF;
  IF (SELECT count(*) FROM lexi.users) <> 1 THEN RAISE EXCEPTION 'FAIL видны чужие учётные записи'; END IF;
  RAISE NOTICE 'OK  не-участник не видит сообщения, канал, состав и чужие учётки';
END $$;
SELECT pg_temp.expect_error($q$INSERT INTO lexi.channel_members (channel_id, user_id, role) VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000b', 'member')$q$, 'самовольное вступление в закрытый канал');
SELECT pg_temp.expect_error($q$INSERT INTO lexi.channel_members (channel_id, user_id, role) VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000b', 'owner')$q$, 'присвоение роли владельца');

-- ---------- без контекста пользователя ----------
SELECT set_config('lexi.user_id', '', false);
DO $$ BEGIN IF (SELECT count(*) FROM lexi.messages) + (SELECT count(*) FROM lexi.identity_keys) <> 0 THEN RAISE EXCEPTION 'FAIL данные видны без входа'; END IF; RAISE NOTICE 'OK  без lexi.user_id не видно ничего'; END $$;

-- ---------- вход и журнал ----------
DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM lexi.auth_lookup('ARSEN');
  IF r.password_hash NOT LIKE '$argon2id$%' THEN RAISE EXCEPTION 'FAIL auth_lookup'; END IF;
  FOR i IN 1..5 LOOP PERFORM lexi.auth_result(r.user_id, false); END LOOP;
  IF EXISTS (SELECT 1 FROM lexi.auth_lookup('arsen')) THEN RAISE EXCEPTION 'FAIL нет блокировки после 5 неудач'; END IF;
  RAISE NOTICE 'OK  auth_lookup регистронезависим, после 5 неудачных входов учётка заблокирована на 15 минут';
END $$;
RESET ROLE;
SELECT pg_temp.expect_error('UPDATE lexi.audit_log SET action = ''auth.ok''', 'правка журнала аудита (даже владельцем)');
SELECT pg_temp.expect_error('DELETE FROM lexi.audit_log', 'удаление журнала аудита');
SELECT pg_temp.expect_error($q$INSERT INTO lexi.audit_log (action, details) VALUES ('test.secret', '{"password":"x"}')$q$, 'секрет в деталях аудита');
DO $$ DECLARE bad int; BEGIN
  SELECT count(*) INTO bad FROM (SELECT row_hash, lag(row_hash) OVER (ORDER BY id) AS prev, prev_hash FROM lexi.audit_log) t WHERE prev IS DISTINCT FROM prev_hash;
  IF bad <> 0 THEN RAISE EXCEPTION 'FAIL хеш-цепочка аудита разорвана'; END IF;
  RAISE NOTICE 'OK  хеш-цепочка аудита цела (% записей)', (SELECT count(*) FROM lexi.audit_log);
END $$;

-- ---------- канал: публикуют только владелец и модераторы ----------
SET ROLE lexi_app;
SELECT set_config('lexi.user_id', '00000000-0000-0000-0000-00000000000a', false);
INSERT INTO lexi.channels (id, slug, kind, is_public, created_by) VALUES ('00000000-0000-0000-0000-0000000000c2', 'lexi-news', 'channel', true, '00000000-0000-0000-0000-00000000000a');
INSERT INTO lexi.channel_members (channel_id, user_id, role) VALUES ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000000a', 'owner');
INSERT INTO lexi.channel_epochs (channel_id, epoch_label, created_by) VALUES ('00000000-0000-0000-0000-0000000000c2', '0mvplqa1b-c2c2c2', '00000000-0000-0000-0000-00000000000a');
SELECT set_config('lexi.user_id', '00000000-0000-0000-0000-00000000000b', false);
INSERT INTO lexi.identity_keys (id, user_id, device_id, kem_public_key)
  VALUES ('00000000-0000-0000-0000-0000000000ab', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000db', decode(repeat('cd', 1184), 'hex'));
INSERT INTO lexi.channel_members (channel_id, user_id, role) VALUES ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000000b', 'member');
SELECT pg_temp.expect_error($q$INSERT INTO lexi.messages (channel_id, epoch_id, sender_id, sender_key_id, client_msg_id, nonce, ciphertext) SELECT channel_id, id, '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000ab', decode('00000000000000c2','hex'), decode('c2c2c2c2c2c2c2c2c2c2c2c2','hex'), decode(repeat('5c',64),'hex') FROM lexi.channel_epochs WHERE channel_id = '00000000-0000-0000-0000-0000000000c2'$q$, 'участник пишет в канал, где публикуют только админы');
DO $$ BEGIN
  IF NOT lexi.can_post('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000000a') THEN RAISE EXCEPTION 'FAIL владелец не может писать в свой канал'; END IF;
  IF lexi.can_post('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000000b') THEN RAISE EXCEPTION 'FAIL участник может писать в канал'; END IF;
  IF NOT lexi.can_post('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000a') THEN RAISE EXCEPTION 'FAIL участник группы не может писать'; END IF;
  RAISE NOTICE 'OK  в канале пишут только владелец и модераторы, в группе — участники';
END $$;

-- ---------- значок «проверенный учёный» ----------
SELECT pg_temp.expect_error($q$SELECT lexi.set_scientist('00000000-0000-0000-0000-00000000000b', true)$q$, 'приложение ставит значок учёного');
SELECT pg_temp.expect_error($q$UPDATE lexi.users SET verified_scientist = true WHERE id = '00000000-0000-0000-0000-00000000000b'$q$, 'пользователь сам ставит себе значок');
RESET ROLE;
SET ROLE lexi_staff;
SELECT set_config('lexi.user_id', '00000000-0000-0000-0000-00000000000a', false);
SELECT lexi.set_scientist('00000000-0000-0000-0000-00000000000b', true, 'ORCID и место работы проверены');
SELECT pg_temp.expect_error($q$SELECT lexi.set_scientist('00000000-0000-0000-0000-00000000000a', true)$q$, 'сотрудник подтверждает сам себя');
RESET ROLE;
DO $$ BEGIN
  IF NOT (SELECT verified_scientist AND verified_by = '00000000-0000-0000-0000-00000000000a' AND verified_at IS NOT NULL FROM lexi.users WHERE id = '00000000-0000-0000-0000-00000000000b') THEN RAISE EXCEPTION 'FAIL значок не поставлен'; END IF;
  IF NOT EXISTS (SELECT 1 FROM lexi.audit_log WHERE action = 'staff.verify' AND target = '00000000-0000-0000-0000-00000000000b') THEN RAISE EXCEPTION 'FAIL подтверждение не в журнале'; END IF;
  RAISE NOTICE 'OK  учёного подтверждает только сотрудник LEXI, действие записано в журнал';
END $$;
SELECT pg_temp.expect_error($q$UPDATE lexi.users SET verified_scientist = true, verified_at = NULL WHERE id = '00000000-0000-0000-0000-00000000000a'$q$, 'значок без даты проверки');

-- ---------- срок хранения ----------
ALTER TABLE lexi.messages DISABLE TRIGGER messages_immutable;
UPDATE lexi.messages SET expires_at = now() - interval '1 day';
ALTER TABLE lexi.messages ENABLE TRIGGER messages_immutable;
SET ROLE lexi_retention;
DO $$ BEGIN IF lexi.purge_expired() <> 1 THEN RAISE EXCEPTION 'FAIL очистка по сроку'; END IF; RAISE NOTICE 'OK  истёкший шифротекст удалён ролью retention'; END $$;
RESET ROLE;
\echo 'Все проверки пройдены.'
