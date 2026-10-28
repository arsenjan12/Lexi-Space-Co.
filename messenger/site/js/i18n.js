// Тексты интерфейса RU / EN. Сообщения участников не переводятся.
const D = {
  ru: {
    'ob.hello': 'HELLO WORLD!', 'ob.interests': 'Что вам интересно?', 'ob.next': 'Далее', 'ob.back': 'Назад',
    'ob.profile': 'Профиль', 'ob.photo': 'Фото', 'ob.welcome': 'Добро пожаловать в', 'ob.enter': 'Войти', 'ob.demo': 'демо',
    'ob.connecting': 'Подключение…', 'ob.fallback': 'Сервер недоступен — открыт демо-режим',
    'pf.name': 'Имя', 'pf.handle': 'Позывной', 'pf.role': 'Роль', 'pf.org': 'Организация', 'pf.orcid': 'ORCID', 'pf.lat': 'Широта', 'pf.lon': 'Долгота', 'pf.bio': 'О себе',
    'tab.threads': 'Ветки', 'tab.channels': 'Каналы', 'tab.chats': 'Чаты', 'tab.all': 'All', 'tab.unread': 'Unread', 'tab.ai': 'LexiAI', 'tab.edit': 'Edit',
    'search': 'Поиск', 'msg.ph': 'Введите сообщение', 'list.title': 'Topics / chats', 'fame': 'Зал славы',
    'empty.unread': 'Всё прочитано', 'empty.chats': 'Личных чатов пока нет', 'empty.threads': 'Веток пока нет', 'empty.chat': 'Сообщений пока нет',
    'home.pick': 'Выберите чат',
    'members': 'участников', 'online': 'в сети', 'channel.only': 'Публикуют администраторы',
    'act.react': 'Реакция', 'act.reply': 'Ответить в ветке', 'act.forward': 'Переслать',
    'thread': 'Ветка', 'replies': 'ответов', 'forward.to': 'Переслать в', 'forwarded': 'Переслано',
    'info.title': 'О чате', 'info.members': 'Участники', 'info.media': 'Медиа и файлы', 'info.desc': 'Описание', 'info.save': 'Сохранить', 'info.mute': 'Без звука', 'info.unmute': 'Со звуком', 'info.leave': 'Покинуть', 'info.admin': 'админ', 'info.nomedia': 'Пока ничего',
    'lock.title': 'Сквозное шифрование', 'lock.text': 'Сообщения шифруются на вашем устройстве: ключи ML-KEM-768, текст AES-256-GCM. Сервер видит только шифротекст.', 'lock.verify': 'Сверить ключи', 'lock.wait': 'Получаем ключ чата…',
    'verify.title': 'Сверка ключей', 'verify.text': 'Сравните отпечаток с тем, что видит собеседник у себя. Совпадает — значит, ключ не подменён.', 'verify.ok': 'Совпадает', 'verify.done': 'сверен',
    'mod.pending': 'На модерации', 'mod.mine': 'Ждёт модерации', 'mod.approve': 'Одобрить', 'mod.reject': 'Отклонить', 'mod.rejected': 'Отклонено модератором', 'mod.ai': 'похоже на ИИ',
    'verified': 'Проверенный учёный', 'ai.label': 'ИИ',
    'plus.file': 'Файл (FITS, изображение)', 'plus.draw': 'Рисунок', 'plus.formula': 'Формула', 'plus.ai': 'Пометить «ИИ»', 'plus.ai.on': 'Снять метку «ИИ»',
    'ai.base': 'База знаний', 'ai.enable': 'Включить нейросеть', 'ai.loading': 'Загрузка', 'ai.ready': 'Нейросеть включена', 'ai.missing': 'Нейросеть доступна на сайте LEXI Space', 'ai.failed': 'Не удалось загрузить нейросеть',
    'ai.hint1': 'Что такое ML-KEM?', 'ai.hint2': 'Доплер 437,5 МГц при 6,9 км/с', 'ai.hint3': 'Где сейчас Юпитер?', 'ai.hint4': 'Как работает глушение GPS?',
    'ai.sources': 'Источники', 'ai.send': 'В чат', 'ai.via': 'по запросу',
    'fame.empty': 'Сюда попадают сообщения, набравшие три и больше реакций',
    'set.title': 'Настройки', 'set.profile': 'Профиль', 'set.look': 'Вид', 'set.conn': 'Связь', 'set.theme': 'Тема', 'set.size': 'Размер текста', 'set.planet': 'Планета на фоне',
    'set.server': 'Адрес сервера', 'set.reconnect': 'Подключиться', 'set.demo': 'Демо-режим', 'set.reset': 'Выйти и сбросить профиль', 'set.save': 'Сохранить',
    'theme.gold': 'Золото', 'theme.cyan': 'Циан', 'theme.light': 'Светлая', 'theme.red': 'Телескоп',
    'new.title': 'Создать', 'new.channel': 'Канал', 'new.group': 'Группа', 'new.name': 'Название', 'new.desc': 'Описание', 'new.premod': 'Премодерация', 'new.noai': 'Без ИИ-сообщений', 'new.create': 'Создать',
    'saved': 'Сохранено', 'copied': 'Скопировано', 'notif': 'Уведомления', 'notif.empty': 'Пока тихо',
    'conn.demo': 'демо', 'conn.offline': 'нет связи', 'conn.connecting': 'подключение',
    'draw.title': 'Рисунок', 'draw.send': 'Отправить', 'draw.clear': 'Очистить', 'draw.eraser': 'Ластик',
    'tools': 'TOOLS',
  },
  en: {
    'ob.hello': 'HELLO WORLD!', 'ob.interests': 'What are you into?', 'ob.next': 'Next', 'ob.back': 'Back',
    'ob.profile': 'Profile', 'ob.photo': 'Photo', 'ob.welcome': 'Welcome to', 'ob.enter': 'Sign in', 'ob.demo': 'demo',
    'ob.connecting': 'Connecting…', 'ob.fallback': 'Server unavailable — demo opened',
    'pf.name': 'Name', 'pf.handle': 'Callsign', 'pf.role': 'Role', 'pf.org': 'Organisation', 'pf.orcid': 'ORCID', 'pf.lat': 'Latitude', 'pf.lon': 'Longitude', 'pf.bio': 'About',
    'tab.threads': 'Threads', 'tab.channels': 'Channels', 'tab.chats': 'Chats', 'tab.all': 'All', 'tab.unread': 'Unread', 'tab.ai': 'LexiAI', 'tab.edit': 'Edit',
    'search': 'Search', 'msg.ph': 'Type a message', 'list.title': 'Topics / chats', 'fame': 'Hall of Fame',
    'empty.unread': 'All caught up', 'empty.chats': 'No direct chats yet', 'empty.threads': 'No threads yet', 'empty.chat': 'No messages yet',
    'home.pick': 'Pick a chat',
    'members': 'members', 'online': 'online', 'channel.only': 'Only admins post here',
    'act.react': 'React', 'act.reply': 'Reply in thread', 'act.forward': 'Forward',
    'thread': 'Thread', 'replies': 'replies', 'forward.to': 'Forward to', 'forwarded': 'Forwarded',
    'info.title': 'About', 'info.members': 'Members', 'info.media': 'Media and files', 'info.desc': 'Description', 'info.save': 'Save', 'info.mute': 'Mute', 'info.unmute': 'Unmute', 'info.leave': 'Leave', 'info.admin': 'admin', 'info.nomedia': 'Nothing yet',
    'lock.title': 'End-to-end encryption', 'lock.text': 'Messages are encrypted on your device: ML-KEM-768 keys, AES-256-GCM text. The server only sees ciphertext.', 'lock.verify': 'Verify keys', 'lock.wait': 'Getting the chat key…',
    'verify.title': 'Verify keys', 'verify.text': 'Compare the fingerprint with what the other person sees. If it matches, the key was not swapped.', 'verify.ok': 'It matches', 'verify.done': 'verified',
    'mod.pending': 'In moderation', 'mod.mine': 'Awaiting moderation', 'mod.approve': 'Approve', 'mod.reject': 'Reject', 'mod.rejected': 'Rejected by moderator', 'mod.ai': 'looks AI-written',
    'verified': 'Verified scientist', 'ai.label': 'AI',
    'plus.file': 'File (FITS, image)', 'plus.draw': 'Drawing', 'plus.formula': 'Formula', 'plus.ai': 'Mark as AI', 'plus.ai.on': 'Remove AI mark',
    'ai.base': 'Knowledge base', 'ai.enable': 'Enable neural network', 'ai.loading': 'Loading', 'ai.ready': 'Neural network on', 'ai.missing': 'The neural network runs on the LEXI Space site', 'ai.failed': 'Could not load the neural network',
    'ai.hint1': 'What is ML-KEM?', 'ai.hint2': 'Doppler 437.5 MHz at 6.9 km/s', 'ai.hint3': 'Where is Jupiter now?', 'ai.hint4': 'How does GPS jamming work?',
    'ai.sources': 'Sources', 'ai.send': 'To chat', 'ai.via': 'asked by',
    'fame.empty': 'Messages with three or more reactions show up here',
    'set.title': 'Settings', 'set.profile': 'Profile', 'set.look': 'Look', 'set.conn': 'Connection', 'set.theme': 'Theme', 'set.size': 'Text size', 'set.planet': 'Background planet',
    'set.server': 'Server address', 'set.reconnect': 'Connect', 'set.demo': 'Demo mode', 'set.reset': 'Sign out and reset', 'set.save': 'Save',
    'theme.gold': 'Gold', 'theme.cyan': 'Cyan', 'theme.light': 'Light', 'theme.red': 'Scope',
    'new.title': 'Create', 'new.channel': 'Channel', 'new.group': 'Group', 'new.name': 'Name', 'new.desc': 'Description', 'new.premod': 'Pre-moderation', 'new.noai': 'No AI messages', 'new.create': 'Create',
    'saved': 'Saved', 'copied': 'Copied', 'notif': 'Notifications', 'notif.empty': 'All quiet',
    'conn.demo': 'demo', 'conn.offline': 'offline', 'conn.connecting': 'connecting',
    'draw.title': 'Drawing', 'draw.send': 'Send', 'draw.clear': 'Clear', 'draw.eraser': 'Eraser',
    'tools': 'TOOLS',
  },
};

let lang = 'ru';
export const getLang = () => lang;
export function setLang(l) { lang = D[l] ? l : 'ru'; document.documentElement.lang = lang; }
export function t(key, vars = {}) {
  let s = D[lang][key] ?? D.ru[key] ?? key;
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  root.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
}
