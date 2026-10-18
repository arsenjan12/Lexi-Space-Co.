-- Сгенерировано scripts/import-data.mjs из lexi-translations.js портала. Руками не править.
INSERT INTO module_texts (module_id, lang, title, lead, goals, threats, physics_math, tech_standards) VALUES
('module1', 'ru', 'Аэрокосмическая кибербезопасность', 'Защищаем бортовой компьютер малого спутника от перехвата управления и подмены прошивки — при жёстких ограничениях памяти и процессора и в условиях космической радиации.', 'Цель модуля — обеспечить доверенную среду исполнения (Trusted Execution Environment, TEE) для бортового компьютера (On-Board Computer, OBC) кубсатов форматов 1U–12U. Такие аппараты работают на низкой околоземной орбите под воздействием ионизирующего излучения и при жёстких аппаратных ограничениях: десятки–сотни килобайт ОЗУ, тактовая частота порядка 48–480 МГц, энергобюджет в единицы ватт.

• **Цепочка доверия от аппаратного корня (Root of Trust).** Неизменяемый загрузчик в ПЗУ проверяет цифровую подпись каждого следующего звена: загрузчика второго уровня, ядра ОСРВ и прикладных задач. Неподписанный или изменённый код не получает управления.
• **Аппаратная изоляция критических функций.** Разделение на защищённый и незащищённый миры средствами ARM TrustZone для Armv8-M (Cortex-M33/M55) и блока защиты физической памяти PMP для RISC-V. Ключи и криптографические операции никогда не покидают защищённого мира.
• **Аутентификация каждой телекоманды** и защита от её повторного воспроизведения на канальном уровне по протоколу CCSDS SDLS.
• **Устойчивость к радиационным сбоям.** Коды обнаружения и исправления ошибок (EDAC/ECC) в памяти, периодическое «вычищение» памяти (scrubbing), троирование критических переменных (TMR) и сторожевой таймер — чтобы одиночный сбой не превращался в уязвимость.
• **Безопасное обновление прошивки по радиоканалу** с проверкой подписи до записи и с откатом к последнему проверенному образу (схема A/B-слотов).', 'Модель угроз строится по матрице SPARTA (Space Attack Research and Tactic Analysis) и дополняется классификацией STRIDE для каждого интерфейса аппарата: радиолинии «Земля — борт», межспутниковой линии, отладочных портов и шины полезной нагрузки.

• **Удалённый перехват управления (Command Injection).** Злоумышленник с собственной наземной станцией формирует или повторяет (replay) телекоманды в открытом канале «Земля — борт». Без аутентификации команда на сброс, смену ориентации или включение двигательной установки исполняется так же, как команда легитимного центра управления.
• **Подмена прошивки (Firmware Spoofing).** Загрузка модифицированного образа через механизм обновления или через отладочный интерфейс (JTAG/SWD), оставленный открытым после интеграции. Закладка в прошивке переживает перезагрузку и полностью компрометирует аппарат.
• **Перехват межспутниковых каналов (Inter-Satellite Link Eavesdropping).** Пассивный приём радиосигнала или рассеянного лазерного излучения межспутниковой линии с соседнего аппарата. При отсутствии шифрования раскрываются телеметрия, ключевой материал и топология группировки.
• **Внесение сбоев (Fault Injection).** Одиночные сбои от тяжёлых заряженных частиц (Single Event Upset) или целенаправленные сбои питания и тактирования способны инвертировать бит результата проверки подписи и обойти безопасную загрузку.
• **Атаки на цепочку поставок.** Компрометация сторонних библиотек, компилятора или инструментов сборки до того, как образ будет подписан.', '**Аутентификация телекоманды.** Каждая команда $TC$ снабжается порядковым номером $SN$ и кодом аутентичности сообщения:
$$t = \mathrm{MAC}_K\left(SN \,\|\, TC\right)$$
Борт исполняет команду только при одновременном выполнении двух условий:
$$\mathrm{Verify}_K\left(SN \,\|\, TC,\ t\right) = 1 \;\wedge\; SN > SN_{\mathrm{last}}$$
Для тега длиной $\tau$ бит вероятность успешной слепой подделки оценивается как $P_{\mathrm{forge}} \approx 2^{-\tau}$; при $\tau = 128$ она пренебрежимо мала.

**Безопасная загрузка.** Образ прошивки $FW$ допускается к исполнению, если
$$\mathrm{Verify}\left(pk_{\mathrm{root}},\ H(FW),\ \sigma\right) = 1,$$
где $H$ — хеш-функция SHA-256 или SHA-384, $\sigma$ — подпись разработчика, $pk_{\mathrm{root}}$ — открытый ключ, записанный в однократно программируемую память.

**Радиационная стойкость.** Частота одиночных сбоев ячейки памяти:
$$\lambda_{\mathrm{SEU}} = \sigma_{\mathrm{SEU}} \cdot \Phi,$$
где $\sigma_{\mathrm{SEU}}$ — сечение сбоя (см²/бит), $\Phi$ — плотность потока частиц (см⁻²·с⁻¹). Надёжность троированного узла с мажоритарным голосованием при надёжности одного канала $R$:
$$R_{\mathrm{TMR}} = 3R^{2} - 2R^{3}$$
Это выражение больше $R$ при $0{,}5 < R < 1$, поэтому критические флаги, счётчики и ключевые переменные хранятся в трёх копиях.

**Энергетика перехвата межспутниковой линии.** Мощность на входе приёмника злоумышленника на расстоянии $d$ определяется формулой Фрииса:
$$P_r = P_t\, G_t\, G_r \left(\frac{\lambda}{4\pi d}\right)^{2}$$
Расчёт показывает, при каком удалении и усилении антенны перехват становится физически возможен, и обосновывает обязательное шифрование межспутниковых линий.', '• **ОСРВ.** FreeRTOS и Zephyr с включённым блоком защиты памяти (MPU), изоляцией задач и минимальным набором системных вызовов; Trusted Firmware-M (TF-M) как эталонная реализация защищённого мира для Armv8-M.
• **Аппаратные платформы.** ARM Cortex-M (Armv7-M; Armv8-M с TrustZone) и RISC-V (RV32IMAC с PMP). Сборка с защитой стека, запретом исполнения данных и проверкой границ буферов.
• **Статический анализ (SAST).** Проверка на соответствие MISRA C:2012 с поправкой AMD1 по безопасности (сводная редакция MISRA C:2023) и SEI CERT C. Анализ встроен в непрерывную интеграцию: сборка с нарушениями обязательных правил блокируется.
• **Подпись прошивки.** ECDSA P-256 или Ed25519, а для аппаратов с длительным сроком службы — постквантовые схемы на хеш-функциях LMS/XMSS (NIST SP 800-208), проверка которых требует минимальных ресурсов.
• **Тестирование на проникновение.** Симуляция векторов атак и аудит безопасности периферии в Kali Linux: фаззинг парсеров телекоманд, анализ радиоинтерфейса с помощью SDR и GNU Radio в экранированной лабораторной среде, проверка отладочных интерфейсов.
• **Стандарты и руководства.** CCSDS 355.0-B-2 (Space Data Link Security Protocol), CCSDS 352.0-B-2 (криптографические алгоритмы), NIST IR 8270 (кибербезопасность коммерческих спутниковых операций), NIST IR 8401 (наземный сегмент и управление спутником), NIST SP 800-53 Rev. 5, NIST SP 800-193 (устойчивость прошивки платформы), ISO/IEC 27001:2022, ISO/IEC 15408 (Common Criteria), ECSS-Q-ST-80C (обеспечение качества ПО космических систем), OWASP FSTM (методология тестирования прошивки) и OWASP IoT Top 10.'),
('module2', 'ru', 'Защита от глушения и целостность GNSS', 'Отличаем настоящий спутниковый сигнал от поддельного и сохраняем точные координаты и время, даже когда эфир подавлен.', 'Цель модуля — обнаруживать и фильтровать сигналы радиоэлектронного подавления (РЭБ) и обеспечивать детерминированную, проверяемую точность позиционирования, навигации и синхронизации времени (PNT) объектов на Земле и на орбите.

• **Обнаружение помехи в реальном времени** по падению отношения несущая/шум $C/N_0$, росту мощности в полосе приёма и изменению коэффициента автоматической регулировки усиления (АРУ).
• **Подавление помех** пространственно-временной адаптивной обработкой (STAP) на антенной решётке из $N$ элементов: формирование провалов («нулей») диаграммы направленности в направлении источников помех.
• **Обнаружение подмены по физической несогласованности.** Доплеровские сдвиги, псевдодальности, углы прихода сигналов, ход часов приёмника и инерциальные данные должны описывать одно и то же движение; расхождение выдаёт ложный сигнал.
• **Контроль целостности решения (RAIM/ARAIM)** с исключением аномальных спутников и вычислением защитного уровня.
• **Проверка подлинности навигационных сообщений** там, где она доступна (Galileo OSNMA).
• **Протоколирование инцидентов** с меткой времени и координатами и передача их в ситуационный центр LEXI Space.', '• **Шумовое глушение (джамминг).** Мощность навигационного сигнала у поверхности Земли — порядка $-130$ дБм, примерно на 20 дБ ниже теплового шума в полосе приёмника. Передатчик мощностью в единицы ватт на расстоянии в десятки километров поднимает шумовой фон настолько, что приёмник теряет захват. Разновидности: широкополосный шум, непрерывная гармоника (CW), сигнал с качающейся частотой (chirp), импульсные помехи.
• **Ретрансляция (meaconing).** Запись подлинного сигнала и его повторное излучение с задержкой: приёмник обрабатывает настоящие навигационные данные, но вычисляет ложные положение и время.
• **Спуфинг координат.** Генерация синтетических сигналов всех видимых спутников с постепенным уводом решения (carry-off), при котором приёмник незаметно переходит с подлинного сигнала на ложный.
• **Нарушение целостности навигационного кадра (Navigation Message Integrity Tampering).** Подмена эфемерид, поправок часов или параметров ионосферной модели в навигационном сообщении приводит к систематической ошибке, которую невозможно обнаружить без криптографической проверки.
• **Атаки на шкалу времени.** Сдвиг времени на единицы микросекунд нарушает синхронизацию энергосистем, сетей связи и финансовых транзакций.', '**Энергетика сигнала.** Спектральная плотность теплового шума $N_0 = kT \approx -174$ дБм/Гц при $T = 290$ К. При мощности сигнала $C \approx -130$ дБм отношение $C/N_0 \approx 44$ дБ·Гц. При наличии помехи мощностью $J$ эффективное отношение несущая/шум:
$$\left(\frac{C}{N_0}\right)_{\mathrm{eff}} = \left[\left(\frac{C}{N_0}\right)^{-1} + \frac{J/C}{Q\,R_c}\right]^{-1}$$
где $R_c$ — частота следования элементов дальномерного кода (1,023 Мчип/с для GPS L1 C/A), $Q$ — коэффициент спектрального разделения помехи (около 1 для узкополосной помехи, 1,5 — для помехи со спектром, совпадающим со спектром сигнала, 2 — для широкополосного шума).

**Доплеровский сдвиг.** Для несущей $f_0$ (1575,42 МГц в диапазоне L1) и относительной скорости $v$, направленной под углом $\theta$ к линии визирования:
$$f_d = f_0\,\frac{v}{c}\cos\theta$$
Для неподвижного наземного приёмника $|f_d|$ не превышает примерно 5 кГц, для приёмника на низкой орбите достигает ±45 кГц. Отклонение измеренного сдвига от прогноза, рассчитанного по эфемеридам и собственной скорости, более чем на порог $\gamma$ указывает на подмену или ретрансляцию.

**Модель псевдодальности:**
$$\rho_i = \lVert \mathbf{r}_i - \mathbf{r}_u \rVert + c\,(\delta t_u - \delta t_i) + I_i + T_i + \varepsilon_i$$
где $\mathbf{r}_i$ и $\mathbf{r}_u$ — положения спутника и пользователя, $\delta t$ — смещения часов, $I_i$ и $T_i$ — ионосферная и тропосферная задержки, $\varepsilon_i$ — шум измерения.

**Адаптивная антенная решётка.** Вектор весовых коэффициентов по критерию минимума дисперсии при неискажённом полезном сигнале (MVDR):
$$\mathbf{w} = \frac{\mathbf{R}^{-1}\mathbf{a}(\theta)}{\mathbf{a}^{H}(\theta)\,\mathbf{R}^{-1}\mathbf{a}(\theta)}$$
где $\mathbf{R}$ — ковариационная матрица принятых отсчётов, $\mathbf{a}(\theta)$ — управляющий вектор. В STAP вектор расширяется до $N \cdot M$ отсчётов ($N$ элементов, $M$ временных отводов), что позволяет подавлять и широкополосные помехи; решётка из $N$ элементов формирует до $N-1$ независимых провалов.

**Верификация телеметрии расширенным фильтром Калмана (EKF):**
$$\hat{\mathbf{x}}_{k|k-1} = f\left(\hat{\mathbf{x}}_{k-1}\right)$$
$$\mathbf{P}_{k|k-1} = \mathbf{F}_k\mathbf{P}_{k-1}\mathbf{F}_k^{T} + \mathbf{Q}_k$$
$$\boldsymbol{\nu}_k = \mathbf{z}_k - h\left(\hat{\mathbf{x}}_{k|k-1}\right)$$
$$\mathbf{S}_k = \mathbf{H}_k\mathbf{P}_{k|k-1}\mathbf{H}_k^{T} + \mathbf{R}_k$$
Измерение признаётся аномальным, если нормированный квадрат невязки превышает квантиль распределения хи-квадрат с $m$ степенями свободы:
$$\varepsilon_k = \boldsymbol{\nu}_k^{T}\mathbf{S}_k^{-1}\boldsymbol{\nu}_k > \chi^{2}_{m,\,1-\alpha}$$

**Орбитальная механика и время.** Положения навигационных спутников и параметры орбит рассчитываются с помощью библиотеки Astropy: гравитационный параметр Земли $\mu = GM_{\oplus}$, массы Земли, Солнца и Юпитера для учёта возмущений третьих тел, шкалы времени GPS, TAI и UTC, преобразования между земной (ITRS) и небесной (GCRS) системами координат. Скорость и период обращения — по интегралу энергии (формула vis-viva):
$$v^{2} = \mu\left(\frac{2}{r} - \frac{1}{a}\right)$$
$$T = 2\pi\sqrt{\frac{a^{3}}{\mu}}$$
Учитывается и релятивистский эффект: бортовые часы GPS уходят вперёд примерно на 38 мкс в сутки, что без поправки дало бы накопление ошибки дальности около 11 км за сутки.', '• **Обработка сигналов.** Программно-определяемое радио (USRP, HackRF) и открытый приёмник GNSS-SDR для лабораторных стендов, GNU Radio для моделирования помех. Излучение помех допускается только в экранированной камере или по кабелю: в открытом эфире это запрещено законом.
• **Алгоритмы.** STAP и формирование луча по критерию MVDR, RAIM/ARAIM, EKF с тестом хи-квадрат по невязкам, проверка согласованности доплеровских сдвигов и псевдодальностей, мониторинг АРУ и $C/N_0$.
• **Аутентификация навигационных данных.** Galileo OSNMA (протокол TESLA с цепочкой ключей); в перспективе — аутентификация сигналов GPS.
• **Вычисления.** Python, NumPy, SciPy и Astropy (физические константы, шкалы времени, системы координат, эфемериды тел Солнечной системы); критичные по времени участки — на C/C++ с векторизацией.
• **Интерфейсные документы и стандарты.** IS-GPS-200 (интерфейс сигналов GPS), Galileo OS SIS ICD, RTCA DO-229 (SBAS), RTCA DO-316 (GPS/ABAS), EUROCAE ED-259 (двухчастотный SBAS), ETSI EN 303 413 (радиооборудование GNSS-приёмников), IEC 61108-1 (морские приёмники), NIST IR 8323 (Foundational PNT Profile), IEEE P1952 (устойчивое оборудование PNT); ISO/IEC 27001:2022 для процессов и NIST SP 800-53 Rev. 5 для мер защиты.'),
('module3', 'ru', 'Постквантовая криптография', 'Переписка в LEXI Messenger, перехваченная сегодня, должна остаться нечитаемой и тогда, когда появятся квантовые компьютеры.', 'Цель модуля — защитить сквозное шифрование (E2EE) в мессенджере LEXI от компрометации архивных перехватов по сценарию «сохрани сейчас — расшифруй потом» (Store Now, Decrypt Later) и обеспечить криптографическую гибкость (crypto-agility) на весь срок жизни системы.

• **Гибридное установление ключей.** Классический X25519 и постквантовый ML-KEM работают одновременно; канал остаётся стойким, пока не взломаны оба механизма.
• **Постквантовая аутентификация.** Подпись ключей устройств и служебных сообщений алгоритмом ML-DSA.
• **Прямая секретность и восстановление после компрометации.** Регулярная смена ключей по схеме двойного храповика (Double Ratchet) с постквантовым расширением.
• **Защита данных на устройстве.** Локальная база SQLite, зашифрованная AES-256 (SQLCipher); ключ хранится в аппаратном хранилище (Secure Enclave, StrongBox, TPM).
• **Минимизация метаданных.** Сервер не хранит историю переписки и не имеет доступа к содержимому сообщений.
• **Замена алгоритмов без перестройки архитектуры.** Идентификаторы алгоритмов в протоколе и поддержка резервных схем (SLH-DSA, HQC).', '• **Алгоритм Шора.** На квантовом компьютере с достаточным числом логических кубитов задачи факторизации целых чисел и дискретного логарифмирования (в мультипликативной группе конечного поля и в группе точек эллиптической кривой) решаются за полиномиальное время — порядка $O(n^{3})$ квантовых операций для $n$-битного модуля. Это разрушает RSA-4096, классический протокол Диффи — Хеллмана, ECDH и ECDSA независимо от длины ключа.
• **Алгоритм Гровера.** Даёт лишь квадратичное ускорение перебора: эффективная стойкость симметричного ключа длиной $k$ бит снижается до $k/2$. Поэтому AES-256 и SHA-384 остаются достаточными, а AES-128 заменяется на AES-256.
• **Store Now, Decrypt Later.** Противник записывает зашифрованный трафик уже сейчас, чтобы расшифровать его после появления криптографически значимого квантового компьютера. Для данных с длительным сроком конфиденциальности — оборонных и научных — угроза актуальна сегодня.
• **Атаки на реализацию.** Утечки по времени выполнения и энергопотреблению (например, KyberSlash), внесение сбоев, слабые генераторы случайных чисел: стойкость алгоритма не защищает от ошибки в коде.
• **Понижение версии (downgrade).** Принуждение сторон к согласованию только классического алгоритма, без постквантовой части.', '**Оценка срочности — неравенство Моски.** Пусть $x$ — сколько лет данные должны оставаться секретными, $y$ — время миграции на новые алгоритмы, $z$ — время до появления квантового компьютера, способного взломать применяемую криптографию. Если
$$x + y > z,$$
то данные уже находятся под угрозой и переход необходимо начинать немедленно.

**Задача обучения с ошибками на модулях (Module-LWE).** Пусть $R_q = \mathbb{Z}_q[X]/(X^{n}+1)$. По открытой матрице $\mathbf{A} \in R_q^{k \times k}$ и вектору
$$\mathbf{b} = \mathbf{A}\mathbf{s} + \mathbf{e} \pmod q,$$
где секрет $\mathbf{s}$ и ошибка $\mathbf{e}$ имеют малые коэффициенты (центрированное биномиальное распределение $B_\eta$), требуется найти $\mathbf{s}$ или отличить пару $(\mathbf{A}, \mathbf{b})$ от равномерно случайной. Эффективные классические и квантовые алгоритмы решения этой задачи неизвестны; к ней сводится стойкость ML-KEM и ML-DSA.

**Параметры ML-KEM (FIPS 203):** $n = 256$, $q = 3329$, $k \in \{2, 3, 4\}$ для ML-KEM-512, ML-KEM-768 и ML-KEM-1024. В LEXI используется ML-KEM-768 (категория стойкости NIST 3, сопоставимая с AES-192): ключ инкапсуляции — 1184 байта, шифртекст — 1088 байт, общий секрет — 32 байта.

**Параметры ML-DSA (FIPS 204):** $q = 8380417$, $n = 256$; для ML-DSA-65 открытый ключ занимает 1952 байта, подпись — 3309 байт.

**Гибридный ключ.** Общие секреты двух механизмов объединяются и поступают в схему выработки ключей TLS 1.3 (схематично):
$$K = \mathrm{HKDF}\left(ss_{\text{ML-KEM}} \,\|\, ss_{\text{X25519}},\ \mathrm{transcript}\right)$$
Чтобы восстановить $K$, противнику необходимо взломать оба механизма.

**Симметричная часть.** Сообщения шифруются AEAD-алгоритмами AES-256-GCM или ChaCha20-Poly1305; с учётом алгоритма Гровера остаточная стойкость составляет не менее $256/2 = 128$ бит.', '• **Стандарты NIST (август 2024).** FIPS 203 — ML-KEM (ранее CRYSTALS-Kyber), FIPS 204 — ML-DSA (ранее CRYSTALS-Dilithium), FIPS 205 — SLH-DSA (SPHINCS+) как резервная подпись на хеш-функциях. HQC выбран NIST в 2025 году как резервный механизм инкапсуляции ключей на иной математической основе.
• **Транспортный уровень.** TLS 1.3 (RFC 8446) с гибридной группой X25519MLKEM768 (кодовая точка 0x11EC) по проекту IETF; X25519 — RFC 7748, HKDF — RFC 5869, ChaCha20-Poly1305 — RFC 8439.
• **Сквозное шифрование.** Асинхронное установление сессии по модели PQXDH и двойной храповик; для групповых чатов — протокол MLS (RFC 9420) с постквантовыми наборами шифров.
• **Реализация.** Библиотека liboqs (Open Quantum Safe) и проверенные реализации с постоянным временем выполнения: без ветвлений и обращений к памяти, зависящих от секрета; тестирование на векторах NIST ACVP.
• **План перехода.** NIST IR 8547 (проект: признание RSA и ECC устаревшими к 2030 году и запрет к 2035 году), NSA CNSA 2.0.
• **Безопасность приложения и процессов.** OWASP MASVS и MASTG для мобильного клиента, OWASP ASVS 5.0 для серверной части, OWASP Cryptographic Storage Cheat Sheet, ISO/IEC 27001:2022, ISO/IEC 18033-2 (асимметричное шифрование), NIST SP 800-56C (выработка ключей), NIST SP 800-227 (рекомендации по механизмам инкапсуляции ключей).'),
('module1', 'en', 'Aerospace Cybersecurity', 'We protect a small satellite’s on-board computer from command hijacking and firmware spoofing, within tight memory and CPU budgets and under space radiation.', 'The module provides a Trusted Execution Environment (TEE) for the On-Board Computer (OBC) of 1U–12U CubeSats. These spacecraft operate in low Earth orbit under ionizing radiation and severe hardware constraints: tens to hundreds of kilobytes of RAM, clock rates of roughly 48–480 MHz and a power budget of a few watts.

• **Chain of trust from a hardware Root of Trust.** An immutable ROM bootloader verifies the digital signature of every subsequent stage: the second-stage bootloader, the RTOS kernel and the application tasks. Unsigned or modified code never gains control.
• **Hardware isolation of critical functions.** Secure and non-secure worlds separated by ARM TrustZone for Armv8-M (Cortex-M33/M55) and by Physical Memory Protection (PMP) on RISC-V. Keys and cryptographic operations never leave the secure world.
• **Authentication of every telecommand** and replay protection at the data-link layer under the CCSDS SDLS protocol.
• **Tolerance to radiation-induced faults.** Error detection and correction (EDAC/ECC) in memory, periodic memory scrubbing, triple modular redundancy (TMR) for critical variables and a watchdog timer, so that a single upset never becomes a vulnerability.
• **Secure over-the-air firmware updates** with signature verification before writing and rollback to the last verified image (A/B slot scheme).', 'The threat model follows the SPARTA matrix (Space Attack Research and Tactic Analysis) and is refined with STRIDE for every spacecraft interface: the ground-to-space radio link, the inter-satellite link, debug ports and the payload bus.

• **Remote command injection.** An adversary with their own ground station forges or replays telecommands on an unprotected uplink. Without authentication, a reset, attitude change or thruster firing command executes exactly like one from the legitimate mission control centre.
• **Firmware spoofing.** A modified image is loaded through the update mechanism or through a debug interface (JTAG/SWD) left open after integration. A firmware implant survives reboots and fully compromises the spacecraft.
• **Inter-satellite link eavesdropping.** Passive reception of the radio signal or of scattered laser light from an inter-satellite link by a nearby spacecraft. Without encryption this exposes telemetry, key material and the constellation topology.
• **Fault injection.** Single Event Upsets caused by heavy charged particles, or deliberate power and clock glitches, can flip the result bit of a signature check and bypass secure boot.
• **Supply-chain attacks.** Compromise of third-party libraries, the compiler or the build tooling before the image is signed.', '**Telecommand authentication.** Every command $TC$ carries a sequence number $SN$ and a message authentication code:
$$t = \mathrm{MAC}_K\left(SN \,\|\, TC\right)$$
The spacecraft executes the command only if both conditions hold:
$$\mathrm{Verify}_K\left(SN \,\|\, TC,\ t\right) = 1 \;\wedge\; SN > SN_{\mathrm{last}}$$
For a $\tau$-bit tag the probability of a successful blind forgery is approximately $P_{\mathrm{forge}} \approx 2^{-\tau}$, which is negligible for $\tau = 128$.

**Secure boot.** A firmware image $FW$ is allowed to execute if
$$\mathrm{Verify}\left(pk_{\mathrm{root}},\ H(FW),\ \sigma\right) = 1,$$
where $H$ is SHA-256 or SHA-384, $\sigma$ is the developer''s signature and $pk_{\mathrm{root}}$ is a public key stored in one-time-programmable memory.

**Radiation tolerance.** The single-event upset rate of a memory cell is
$$\lambda_{\mathrm{SEU}} = \sigma_{\mathrm{SEU}} \cdot \Phi,$$
where $\sigma_{\mathrm{SEU}}$ is the upset cross-section (cm²/bit) and $\Phi$ is the particle flux (cm⁻²·s⁻¹). The reliability of a triplicated node with majority voting, given single-channel reliability $R$, is
$$R_{\mathrm{TMR}} = 3R^{2} - 2R^{3}$$
This exceeds $R$ whenever $0.5 < R < 1$, which is why critical flags, counters and key variables are kept in three copies.

**Link budget of an eavesdropper.** The power received by an adversary at distance $d$ follows the Friis transmission equation:
$$P_r = P_t\, G_t\, G_r \left(\frac{\lambda}{4\pi d}\right)^{2}$$
The calculation shows at what distance and antenna gain interception becomes physically feasible, and justifies mandatory encryption of inter-satellite links.', '• **RTOS.** FreeRTOS and Zephyr with the Memory Protection Unit (MPU) enabled, task isolation and a minimal system-call surface; Trusted Firmware-M (TF-M) as the reference secure-world implementation for Armv8-M.
• **Hardware targets.** ARM Cortex-M (Armv7-M; Armv8-M with TrustZone) and RISC-V (RV32IMAC with PMP). Builds use stack protection, non-executable data regions and buffer bounds checking.
• **Static analysis (SAST).** Compliance checks against MISRA C:2012 with the security amendment AMD1 (consolidated as MISRA C:2023) and SEI CERT C. Analysis runs in continuous integration, and a build that violates a mandatory rule is blocked.
• **Firmware signing.** ECDSA P-256 or Ed25519 and, for long-lived missions, post-quantum hash-based schemes LMS/XMSS (NIST SP 800-208), whose verification needs minimal resources.
• **Penetration testing.** Attack-vector simulation and peripheral security audits in Kali Linux: fuzzing of telecommand parsers, radio-interface analysis with SDR and GNU Radio in a shielded laboratory, review of debug interfaces.
• **Standards and guidance.** CCSDS 355.0-B-2 (Space Data Link Security Protocol), CCSDS 352.0-B-2 (Cryptographic Algorithms), NIST IR 8270 (Cybersecurity for Commercial Satellite Operations), NIST IR 8401 (Satellite Ground Segment), NIST SP 800-53 Rev. 5, NIST SP 800-193 (Platform Firmware Resiliency), ISO/IEC 27001:2022, ISO/IEC 15408 (Common Criteria), ECSS-Q-ST-80C (Software Product Assurance), OWASP FSTM (Firmware Security Testing Methodology) and the OWASP IoT Top 10.'),
('module2', 'en', 'GNSS Anti-Jamming and Integrity', 'We tell a genuine satellite signal from a forged one and keep position and time accurate even when the spectrum is jammed.', 'The module detects and filters electronic-warfare interference and delivers deterministic, verifiable positioning, navigation and timing (PNT) accuracy for assets on the ground and in orbit.

• **Real-time interference detection** from a drop in the carrier-to-noise density ratio $C/N_0$, rising in-band power and changes in automatic gain control (AGC).
• **Interference suppression** by space-time adaptive processing (STAP) on an $N$-element antenna array, steering nulls of the antenna pattern towards the interference sources.
• **Spoofing detection through physical inconsistency.** Doppler shifts, pseudoranges, angles of arrival, receiver clock behaviour and inertial data must all describe the same motion; any mismatch exposes a forged signal.
• **Integrity monitoring (RAIM/ARAIM)** with exclusion of faulty satellites and computation of protection levels.
• **Navigation message authentication** where available (Galileo OSNMA).
• **Incident logging** with time and position stamps, forwarded to the LEXI Space situation center.', '• **Noise jamming.** A navigation signal arrives at the Earth''s surface at about $-130$ dBm, roughly 20 dB below the thermal noise in the receiver bandwidth. A transmitter of a few watts tens of kilometres away raises the noise floor enough for the receiver to lose lock. Variants include broadband noise, continuous wave (CW), swept-frequency (chirp) and pulsed jamming.
• **Meaconing.** A genuine signal is recorded and rebroadcast with a delay: the receiver processes authentic navigation data yet computes a false position and time.
• **Coordinate spoofing.** Synthetic signals for every visible satellite are generated and the solution is gradually dragged away (carry-off), so the receiver silently switches from the genuine signal to the counterfeit one.
• **Navigation message integrity tampering.** Altered ephemerides, clock corrections or ionospheric model parameters in the navigation message cause a systematic error that cannot be detected without cryptographic verification.
• **Timing attacks.** A shift of a few microseconds in the time scale disrupts the synchronisation of power grids, telecommunications networks and financial transactions.', '**Signal budget.** The thermal noise power spectral density is $N_0 = kT \approx -174$ dBm/Hz at $T = 290$ K. With a received signal power of $C \approx -130$ dBm the ratio is $C/N_0 \approx 44$ dB-Hz. In the presence of a jammer of power $J$ the effective carrier-to-noise density ratio becomes
$$\left(\frac{C}{N_0}\right)_{\mathrm{eff}} = \left[\left(\frac{C}{N_0}\right)^{-1} + \frac{J/C}{Q\,R_c}\right]^{-1}$$
where $R_c$ is the ranging-code chipping rate (1.023 Mchip/s for GPS L1 C/A) and $Q$ is the spectral separation coefficient of the interference (about 1 for narrowband, 1.5 for signal-matched and 2 for broadband noise jamming).

**Doppler shift.** For a carrier $f_0$ (1575.42 MHz in the L1 band) and a relative velocity $v$ at an angle $\theta$ to the line of sight:
$$f_d = f_0\,\frac{v}{c}\cos\theta$$
For a static ground receiver $|f_d|$ stays below roughly 5 kHz; for a receiver in low Earth orbit it reaches ±45 kHz. A deviation of the measured shift from the value predicted from ephemerides and own velocity by more than a threshold $\gamma$ indicates spoofing or meaconing.

**Pseudorange model:**
$$\rho_i = \lVert \mathbf{r}_i - \mathbf{r}_u \rVert + c\,(\delta t_u - \delta t_i) + I_i + T_i + \varepsilon_i$$
where $\mathbf{r}_i$ and $\mathbf{r}_u$ are the satellite and user positions, $\delta t$ are clock offsets, $I_i$ and $T_i$ are ionospheric and tropospheric delays and $\varepsilon_i$ is measurement noise.

**Adaptive antenna array.** The minimum-variance distortionless-response (MVDR) weight vector is
$$\mathbf{w} = \frac{\mathbf{R}^{-1}\mathbf{a}(\theta)}{\mathbf{a}^{H}(\theta)\,\mathbf{R}^{-1}\mathbf{a}(\theta)}$$
where $\mathbf{R}$ is the covariance matrix of the received samples and $\mathbf{a}(\theta)$ is the steering vector. STAP extends the vector to $N \cdot M$ samples ($N$ elements, $M$ time taps), which also suppresses wideband interference; an $N$-element array can place up to $N-1$ independent nulls.

**Telemetry verification with an extended Kalman filter (EKF):**
$$\hat{\mathbf{x}}_{k|k-1} = f\left(\hat{\mathbf{x}}_{k-1}\right)$$
$$\mathbf{P}_{k|k-1} = \mathbf{F}_k\mathbf{P}_{k-1}\mathbf{F}_k^{T} + \mathbf{Q}_k$$
$$\boldsymbol{\nu}_k = \mathbf{z}_k - h\left(\hat{\mathbf{x}}_{k|k-1}\right)$$
$$\mathbf{S}_k = \mathbf{H}_k\mathbf{P}_{k|k-1}\mathbf{H}_k^{T} + \mathbf{R}_k$$
A measurement is flagged as anomalous when its normalized innovation squared exceeds the chi-square quantile with $m$ degrees of freedom:
$$\varepsilon_k = \boldsymbol{\nu}_k^{T}\mathbf{S}_k^{-1}\boldsymbol{\nu}_k > \chi^{2}_{m,\,1-\alpha}$$

**Orbital mechanics and time.** Navigation satellite positions and orbital parameters are computed with the Astropy library: Earth''s gravitational parameter $\mu = GM_{\oplus}$, the masses of the Earth, Sun and Jupiter for third-body perturbations, the GPS, TAI and UTC time scales, and transformations between the terrestrial (ITRS) and celestial (GCRS) reference frames. Orbital speed and period follow the vis-viva equation:
$$v^{2} = \mu\left(\frac{2}{r} - \frac{1}{a}\right)$$
$$T = 2\pi\sqrt{\frac{a^{3}}{\mu}}$$
Relativity is included as well: GPS satellite clocks run fast by about 38 µs per day, which uncorrected would accumulate a ranging error of roughly 11 km per day.', '• **Signal processing.** Software-defined radio (USRP, HackRF) and the open-source GNSS-SDR receiver for laboratory test benches; GNU Radio for interference modelling. Jamming signals are transmitted only inside a shielded chamber or over cable, since radiating them over the air is illegal.
• **Algorithms.** STAP and MVDR beamforming, RAIM/ARAIM, EKF with chi-square innovation testing, Doppler and pseudorange consistency checks, AGC and $C/N_0$ monitoring.
• **Navigation data authentication.** Galileo OSNMA (TESLA protocol with a key chain), and GPS signal authentication as it becomes available.
• **Computation.** Python, NumPy, SciPy and Astropy (physical constants, time scales, reference frames, Solar System ephemerides); time-critical paths in C/C++ with vectorisation.
• **Interface documents and standards.** IS-GPS-200 (GPS signal interface), Galileo OS SIS ICD, RTCA DO-229 (SBAS), RTCA DO-316 (GPS/ABAS), EUROCAE ED-259 (dual-frequency SBAS), ETSI EN 303 413 (GNSS receiver radio equipment), IEC 61108-1 (maritime receivers), NIST IR 8323 (Foundational PNT Profile), IEEE P1952 (Resilient PNT User Equipment); ISO/IEC 27001:2022 for processes and NIST SP 800-53 Rev. 5 for security controls.'),
('module3', 'en', 'Post-Quantum Cryptography', 'LEXI Messenger traffic intercepted today must stay unreadable even once quantum computers arrive.', 'The module protects end-to-end encryption (E2EE) in the LEXI messenger against the compromise of archived intercepts under the Store Now, Decrypt Later scenario, and provides crypto-agility for the whole lifetime of the system.

• **Hybrid key establishment.** Classical X25519 and post-quantum ML-KEM run together; the channel stays secure as long as either mechanism remains unbroken.
• **Post-quantum authentication.** Device keys and control messages are signed with ML-DSA.
• **Forward secrecy and post-compromise security.** Continuous key rotation using the Double Ratchet with a post-quantum extension.
• **On-device data protection.** A local SQLite database encrypted with AES-256 (SQLCipher), with the key held in hardware-backed storage (Secure Enclave, StrongBox, TPM).
• **Metadata minimisation.** The server keeps no message history and has no access to message content.
• **Algorithm replacement without re-architecture.** Algorithm identifiers in the protocol and support for fallback schemes (SLH-DSA, HQC).', '• **Shor''s algorithm.** On a quantum computer with enough logical qubits, integer factorisation and the discrete logarithm problem (in the multiplicative group of a finite field and in elliptic-curve groups) are solved in polynomial time, on the order of $O(n^{3})$ quantum operations for an $n$-bit modulus. This breaks RSA-4096, classical Diffie–Hellman, ECDH and ECDSA regardless of key length.
• **Grover''s algorithm.** It gives only a quadratic speed-up for exhaustive search, reducing the effective strength of a $k$-bit symmetric key to $k/2$ bits. AES-256 and SHA-384 therefore remain adequate, while AES-128 is replaced by AES-256.
• **Store Now, Decrypt Later.** An adversary records encrypted traffic today in order to decrypt it once a cryptographically relevant quantum computer exists. For data with long confidentiality requirements, such as defence and research, the threat is already current.
• **Implementation attacks.** Timing and power side channels (for example KyberSlash), fault injection and weak random number generators: a strong algorithm does not protect against a bug in the code.
• **Downgrade attacks.** Forcing the parties to negotiate only the classical algorithm, without the post-quantum component.', '**Urgency estimate: Mosca''s inequality.** Let $x$ be how many years the data must stay secret, $y$ the time needed to migrate to new algorithms and $z$ the time until a quantum computer can break the cryptography in use. If
$$x + y > z,$$
the data is already at risk and migration must start immediately.

**Module Learning With Errors (Module-LWE).** Let $R_q = \mathbb{Z}_q[X]/(X^{n}+1)$. Given a public matrix $\mathbf{A} \in R_q^{k \times k}$ and the vector
$$\mathbf{b} = \mathbf{A}\mathbf{s} + \mathbf{e} \pmod q,$$
where the secret $\mathbf{s}$ and the error $\mathbf{e}$ have small coefficients (centred binomial distribution $B_\eta$), the task is to recover $\mathbf{s}$ or to distinguish $(\mathbf{A}, \mathbf{b})$ from a uniformly random pair. No efficient classical or quantum algorithm for this problem is known; the security of ML-KEM and ML-DSA reduces to it.

**ML-KEM parameters (FIPS 203):** $n = 256$, $q = 3329$, $k \in \{2, 3, 4\}$ for ML-KEM-512, ML-KEM-768 and ML-KEM-1024. LEXI uses ML-KEM-768 (NIST security category 3, comparable to AES-192): a 1184-byte encapsulation key, a 1088-byte ciphertext and a 32-byte shared secret.

**ML-DSA parameters (FIPS 204):** $q = 8380417$, $n = 256$; for ML-DSA-65 the public key is 1952 bytes and the signature 3309 bytes.

**Hybrid key.** The shared secrets of both mechanisms are concatenated and fed into the TLS 1.3 key schedule (schematically):
$$K = \mathrm{HKDF}\left(ss_{\text{ML-KEM}} \,\|\, ss_{\text{X25519}},\ \mathrm{transcript}\right)$$
To recover $K$ an adversary has to break both mechanisms.

**Symmetric layer.** Messages are encrypted with the AEAD ciphers AES-256-GCM or ChaCha20-Poly1305; accounting for Grover''s algorithm, the residual strength is at least $256/2 = 128$ bits.', '• **NIST standards (August 2024).** FIPS 203 — ML-KEM (formerly CRYSTALS-Kyber), FIPS 204 — ML-DSA (formerly CRYSTALS-Dilithium), FIPS 205 — SLH-DSA (SPHINCS+) as a hash-based fallback signature. In 2025 NIST selected HQC as a backup key-encapsulation mechanism built on different mathematics.
• **Transport layer.** TLS 1.3 (RFC 8446) with the hybrid group X25519MLKEM768 (code point 0x11EC) per the IETF draft; X25519 — RFC 7748, HKDF — RFC 5869, ChaCha20-Poly1305 — RFC 8439.
• **End-to-end encryption.** Asynchronous session setup following the PQXDH model plus the Double Ratchet; for group chats, the MLS protocol (RFC 9420) with post-quantum cipher suites.
• **Implementation.** The liboqs library (Open Quantum Safe) and vetted constant-time implementations with no secret-dependent branches or memory access; testing against NIST ACVP vectors.
• **Migration plan.** NIST IR 8547 (draft: RSA and ECC deprecated by 2030 and disallowed by 2035) and NSA CNSA 2.0.
• **Application and process security.** OWASP MASVS and MASTG for the mobile client, OWASP ASVS 5.0 for the server side, the OWASP Cryptographic Storage Cheat Sheet, ISO/IEC 27001:2022, ISO/IEC 18033-2 (asymmetric ciphers), NIST SP 800-56C (key derivation) and NIST SP 800-227 (recommendations for key-encapsulation mechanisms).');
