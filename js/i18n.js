// Английский интерфейс: переводим тексты прямо на странице, не трогая названия треков, артистов и альбомов.
// Целые строки — по словарю, длинные фразы внутри строк — по словарю, числа с «треков/мин» — шаблонами.
const EN = {
  'Авторы': 'Artists', 'Альбом или плейлист': 'Album or playlist', 'Альбомов пока нет': 'No albums yet', 'Альбомы': 'Albums', 'Артист': 'Artist',
  'Артист и название': 'Artist and title', 'Без артиста': 'No artist', 'Без названия': 'Untitled', 'Без перехода': 'No crossfade',
  'Без интернета волне нечего играть: треки ещё не скачаны': 'Offline, the wave has nothing to play: tracks are not downloaded yet',
  'Без ключа распознавание работает несколько раз в день. Бесплатный ключ на': 'Without a key, recognition works a few times a day. Free key at',
  'Без него плеер не сможет сохранять музыку': 'Without it the player cannot save music',
  'Бесконечный поток: твои треки вперемешку с похожими. Пропуски и лайки меняют его на ходу': 'An endless stream: your tracks mixed with similar ones. Skips and likes reshape it on the fly',
  'Бот для поиска музыки': 'Music search bot', 'Браузер': 'Browser',
  'Браузер заблокировал окно мини-плеера. Разреши всплывающие окна для этой страницы': 'The browser blocked the mini player. Allow pop-ups for this page',
  'В Mix названия верные': 'Titles are correct in Mix', 'В «Хочу скачать»': 'To “Wishlist”', 'В интернете': 'On the web', 'В любимое': 'Like',
  'В очереди': 'Queued', 'В очередь': 'Add to queue',
  'В этом коде твои ключи Telegram. Сам по себе он не даёт войти в аккаунт, но никому его не показывай': 'This code contains your Telegram keys. It can’t log in by itself, but don’t show it to anyone',
  'Введи номер и код из Telegram. Всё остальное подтянется само': 'Enter your number and the Telegram code. Everything else syncs by itself',
  'Вернуть исходное название': 'Restore original title', 'Включи любой трек, и история появится здесь': 'Play any track and your history will appear here',
  'Включить распознавание по звуку': 'Enable recognition by sound', 'Во все песни (пока 30 секунд)': 'To all songs (30-second preview for now)',
  'Войти': 'Log in', 'Волна': 'Wave', 'Волне нечего играть: все треки отмечены как «не моё»': 'Nothing for the wave: all tracks are marked “not for me”',
  'Все названия в порядке': 'All titles are fine', 'Все треки уже подтверждены': 'All tracks are already confirmed', 'Вставить': 'Paste',
  'Вставь ссылку на плейлист': 'Paste a playlist link', 'Вся музыка': 'All music', 'Всё верно, дальше': 'Looks right, continue',
  'Всё время': 'All time', 'Выбери канал с музыкой': 'Choose your music channel',
  'Выбери свой канал. Mix скачает из него все аудиофайлы и будет подтягивать новые': 'Choose your channel. Mix will download all audio files from it and keep fetching new ones',
  'Выбери трек': 'Pick a track', 'Выбрано вручную': 'Chosen manually', 'Выбрать бота': 'Choose bot', 'Выбрать канал': 'Choose channel',
  'Выбрать свой канал с музыкой': 'Choose your music channel', 'Выше': 'Up', 'ГБ': 'GB', 'Год': 'Year', 'Готово': 'Done',
  'Громкие треки чуть тише, тихие — громче, чтобы не крутить звук от песни к песне': 'Loud tracks a bit quieter, quiet ones louder — no more volume riding between songs',
  'Громкость': 'Volume', 'Давно не слушал': 'Haven’t heard in a while', 'Дальше': 'Up next',
  'Дальше нет треков, которые можно включить': 'No playable tracks further on', 'Дальше по списку': 'Next in list',
  'Дата выхода: новые': 'Release date: newest', 'Дата выхода: старые': 'Release date: oldest', 'Дискография': 'Discography',
  'Длина перехода': 'Crossfade length', 'Для подборки нужен интернет': 'Recommendations need internet', 'Добавить': 'Add',
  'Добавить в любимое, альбом или мою музыку': 'Add to likes, album or my music', 'Добавить в плейлист': 'Add to playlist',
  'Добавить в плейлист или альбом': 'Add to playlist or album', 'Добавить во все песни или в плейлист': 'Add to all songs or a playlist',
  'Добавить файлы': 'Add files', 'Добавить файлы с компьютера': 'Add files from computer', 'Добавлено': 'Added', 'Добавлено в «': 'Added to “',
  'Добавлено в «Хочу скачать»': 'Added to “Wishlist”', 'Добавлено в любимое': 'Added to likes',
  'Добавлено. Полная версия заменит превью, когда появится в канале': 'Added. The full version will replace the preview once it appears in your channel',
  'Добавлять похожие (бесплатно доступно только 30 секунд)': 'Add similar tracks (only 30-second previews are free)',
  'Другая подборка': 'Another mix', 'Другой': 'Other', 'Дубликатов нет': 'No duplicates', 'Дубликаты': 'Duplicates',
  'Если стоит блокировщик рекламы, отключи его для этой страницы': 'If you use an ad blocker, disable it for this page',
  'Ещё': 'More', 'Ещё не скачан': 'Not downloaded yet', 'Ещё раз': 'Try again',
  'За последние 4 месяца у твоих артистов ничего не выходило. Mix проверяет раз в сутки': 'Your artists released nothing in the last 4 months. Mix checks once a day',
  'Загружаю список чатов…': 'Loading chats…', 'Закрыть': 'Close', 'Заново распознать всё, что не подтверждено по звуку или тобой': 'Re-recognize everything not confirmed by sound or by you',
  'Запустить мою волну': 'Start my wave', 'Звук не совпадает с названием': 'Sound doesn’t match the title', 'Здесь будет любимое': 'Your likes will be here',
  'Играть': 'Play', 'Играть / пауза': 'Play / pause', 'Играть следующим': 'Play next', 'Из Apple Music': 'From Apple Music', 'Из Deezer': 'From Deezer',
  'Из Spotify': 'From Spotify', 'Из этого альбома у тебя пока ничего нет': 'You have nothing from this album yet', 'Избранное': 'Saved Messages',
  'Изменить название': 'Edit title', 'Или впиши сам': 'Or type it yourself', 'Импорт': 'Import', 'Импорт плейлиста': 'Import playlist',
  'Инструкция для друга': 'Guide for a friend', 'Исправлен первый пост: «': 'First post fixed: “', 'Исправлено': 'Fixed', 'Исправлено само': 'Fixed automatically',
  'Исправлять и в канале': 'Fix in the channel too', 'Исправляю посты в канале': 'Fixing posts in the channel', 'Итоги': 'Stats',
  'Ищу альбомы…': 'Looking for albums…', 'Ищу заново': 'Searching again', 'Ищу новинки…': 'Looking for new releases…', 'Ищу текст…': 'Looking for lyrics…', 'Ищу…': 'Searching…',
  'Каждый трек в библиотеке встречается один раз': 'Every track in your library appears once', 'Как Шазам': 'Like Shazam', 'Какой это трек?': 'Which track is this?',
  'Канал': 'Channel', 'Канал больше не меняем. Названия исправляются только в Mix': 'The channel is no longer edited. Titles are fixed only in Mix',
  'Канал не найден. Возможно, ты из него вышел': 'Channel not found. Maybe you left it', 'Ключ AcoustID': 'AcoustID key',
  'Ключи api_id и api_hash — бесплатно на my.telegram.org → API development tools (Mix сам покажет, как)': 'api_id and api_hash keys are free at my.telegram.org → API development tools (Mix will show you how)',
  'Код': 'Code', 'Код из Telegram': 'Code from Telegram', 'Код не подошёл, проверь и введи снова': 'Wrong code, check and enter it again',
  'Код не подошёл. Скопируй его на компьютере ещё раз': 'Wrong code. Copy it on the computer again', 'Код плеера не загрузился за 8 секунд': 'The player code didn’t load in 8 seconds',
  'Код пришёл в чат «Telegram» в приложении': 'The code was sent to the “Telegram” chat in the app', 'Код с компьютера': 'Code from computer', 'Код скопирован': 'Code copied',
  'Код устарел, введи номер заново': 'The code expired, enter your number again', 'Лишние копии убраны': 'Extra copies removed', 'Любимое': 'Liked',
  'Любимое за месяц': 'Top of the month', 'Месяц': 'Month', 'Микс': 'Mix', 'Мини-плеер: маленькое окно поверх остальных': 'Mini player: a small window on top of others',
  'Моя волна': 'My wave', 'Музыка': 'Music', 'Музыка из твоего канала': 'Music from your channel',
  'На устройстве': 'On device', 'Наведи камеру iPhone на код и открой ссылку': 'Point your iPhone camera at the code and open the link',
  'Нажать «Подключить Telegram» и войти своим номером': 'Tap “Connect Telegram” and log in with your number', 'Нажми «Поделиться», затем': 'Tap “Share”, then',
  'Нажми «⋯» у любого трека и выбери «Добавить в плейлист»': 'Tap “⋯” on any track and choose “Add to playlist”',
  'Нажми на альбом — увидишь, каких песен не хватает': 'Tap an album to see which songs are missing', 'Нажми на поле и вставь код вручную': 'Tap the field and paste the code manually',
  'Нажми на сердечко у трека, и он появится в этом списке': 'Tap the heart on a track and it will appear here',
  'Нажми плюс у похожего трека в Волне. Он попадёт сюда, а когда полная версия появится в твоём канале, сама заменит превью': 'Tap plus on a similar track in the Wave. It lands here, and when the full version appears in your channel it replaces the preview',
  'Нажми плюс у трека и выбери «В очередь»': 'Tap plus on a track and choose “Add to queue”', 'Нажми там «Подключить телефон» и вставь код сюда': 'Tap “Connect phone” there and paste the code here',
  'Нажми — откроется вся дискография': 'Tap to open the full discography', 'Нажми — откроется дискография': 'Tap to open the discography', 'Нажми, чтобы скрыть': 'Tap to hide',
  'Назад': 'Back', 'Название': 'Title', 'Название возвращено': 'Title restored', 'Найдено в интернете': 'Found on the web', 'Найдено по тексту песни': 'Found by lyrics',
  'Найди вручную или попробуй распознать ещё раз': 'Find it manually or try to recognize again', 'Найти': 'Find', 'Найти все треки': 'Recognize all tracks', 'Найти канал': 'Find channel',
  'Найти полный трек в Telegram': 'Find the full track in Telegram', 'Найти трек или артиста': 'Search tracks or artists', 'Найти через бота': 'Find via bot', 'Найти через бота в Telegram': 'Find via bot in Telegram',
  'Напиши имя бота в Telegram, через которого ты находишь треки. Mix будет открывать его с уже вставленным названием песни': 'Enter the Telegram bot you use to find tracks. Mix will open it with the song title already filled in',
  'Например, «В дорогу»': 'For example, “Road trip”', 'Не загрузился код плеера': 'The player code didn’t load', 'Не моё': 'Not for me',
  'Не нашлась в каталоге или он сейчас недоступен — открой артиста чуть позже': 'Not found in the catalog or it’s unavailable — open the artist a bit later',
  'Не нашёл ни одной песни': 'No songs found', 'Не открывается хранилище': 'Storage won’t open', 'Не получилось открыть этот файл': 'Couldn’t open this file',
  'Не получилось подключиться': 'Couldn’t connect', 'Не получилось распознать': 'Couldn’t recognize', 'Не получилось скопировать': 'Couldn’t copy', 'Не получилось, проверь интернет': 'Failed, check your internet',
  'Не распознан': 'Not recognized', 'Не распознано': 'Not recognized', 'Не распознаны': 'Not recognized', 'Не сейчас': 'Not now', 'Не скачано': 'Not downloaded', 'Не трогать канал': 'Don’t touch the channel',
  'Не удалось получить список чатов. Проверь интернет и попробуй ещё раз': 'Couldn’t load chats. Check your internet and try again',
  'Не узнал. Попробуй ближе к источнику звука, на более громком месте': 'Didn’t recognize. Try closer to the sound, at a louder part',
  'Недавние': 'Recent', 'Недостающие — в «Хочу скачать»': 'Missing ones go to “Wishlist”', 'Неизвестный артист': 'Unknown artist',
  'Нет прав редактировать посты в этом канале. Исправления сохранены только в Mix': 'No rights to edit posts in this channel. Fixes are saved only in Mix',
  'Нет связи с Telegram': 'No connection to Telegram', 'Нет связи с Telegram, канал обновлю позже': 'No connection to Telegram, will update the channel later', 'Нет связи с Telegram, отправлю позже': 'No connection to Telegram, will send later',
  'Ниже весь трек-лист: плюс — в «Хочу скачать», «Найти» — открыть бота': 'Full tracklist below: plus adds to “Wishlist”, “Find” opens the bot',
  'Никого не нашлось': 'No one found', 'Ничего не играет': 'Nothing playing', 'Ничего не нашлось': 'Nothing found',
  'Ничего не нашлось. Попробуй короче: только артист или только название': 'Nothing found. Try shorter: just the artist or just the title',
  'Новая версия включится при следующем запуске': 'The new version will start next launch', 'Новинки': 'New releases', 'Новинок нет': 'No new releases',
  'Новое в канале': 'New in channel', 'Новое для тебя': 'New for you', 'Новые релизы твоих артистов за 4 месяца': 'New releases from your artists in the last 4 months',
  'Новые треки из канала будут проверяться сами, как только скачаются': 'New tracks from the channel will be checked automatically once downloaded',
  'Новый альбом или плейлист': 'New album or playlist', 'Новый плейлист': 'New playlist', 'Номер не подошёл, введи в формате +7…': 'Invalid number, use the +1… format',
  'Номер телефона в формате +7…': 'Phone number in +1… format', 'Нравится: будет больше такого': 'Like: more like this', 'Нужно войти в Telegram заново': 'You need to log in to Telegram again',
  'Облачный пароль': 'Cloud password', 'Обновить': 'Refresh', 'Они появятся, когда в библиотеке будет музыка': 'They’ll appear once your library has music',
  'Они соберутся сами, когда Mix распознает треки и узнает, с каких они альбомов': 'They’ll build themselves once Mix recognizes tracks and their albums',
  'Оставить': 'Keep', 'Оставить по одной во всех': 'Keep one of each', 'Оставить этот': 'Keep this one', 'Оставлена одна копия': 'One copy kept',
  'Оставь одну копию, остальные уберутся из Mix. Лайки и плейлисты перейдут на оставленную. Посты в канале не трогаются': 'Keep one copy, the rest are removed from Mix. Likes and playlists move to the kept one. Channel posts aren’t touched',
  'Остановить': 'Stop', 'Открой': 'Open', 'Открыть бота в Telegram': 'Open the bot in Telegram',
  'Открыть ссылку на телефоне в Safari → «Поделиться» → «На экран Домой»': 'Open the link on the phone in Safari → “Share” → “Add to Home Screen”',
  'Откуда брать музыку?': 'Where to get music?', 'Отмена': 'Cancel', 'Отправить': 'Send', 'Отправить в канал файлы с компьютера': 'Send computer files to the channel',
  'Отправить в канал?': 'Send to channel?', 'Отправлено': 'Sent', 'Отправляю в канал': 'Sending to channel', 'Отправь название боту, потом перешли трек в свой канал': 'Send the title to the bot, then forward the track to your channel',
  'Очередь': 'Queue', 'Очистить': 'Clear', 'Пароль': 'Password', 'Пароль не подошёл': 'Wrong password', 'Пауза / играть': 'Pause / play',
  'Перемешивать': 'Shuffle', 'Переход между треками': 'Crossfade', 'Плейлист': 'Playlist', 'Плейлист «': 'Playlist “', 'Плейлист пока пустой': 'The playlist is empty',
  'Плейлисты': 'Playlists', 'Плюс — в «Хочу скачать», «Найти» — открыть бота в Telegram с этим названием': 'Plus adds to “Wishlist”, “Find” opens the Telegram bot with this title',
  'По автору': 'By artist', 'По альбому': 'By album', 'По запросу «': 'For “', 'По звуку': 'By sound', 'По названию': 'By title', 'По названию файла': 'By file name',
  'Повторять': 'Repeat', 'Подбираю, первый раз это около 30 секунд': 'Picking tracks, the first time takes about 30 seconds',
  'Подборка соберётся сама, когда ты послушаешь больше музыки': 'The mix will build itself as you listen to more music',
  'Подборка строится по твоей музыке. Добавь треки, и она появится': 'The mix is built from your music. Add tracks and it will appear',
  'Подборки': 'Mixes', 'Подключаем Telegram': 'Connecting Telegram', 'Подключаюсь…': 'Connecting…',
  'Подключи Telegram-канал, и Mix проверит названия всех треков': 'Connect a Telegram channel and Mix will check all track titles',
  'Подключи свой канал с музыкой': 'Connect your music channel', 'Подключить': 'Connect', 'Подключить Telegram': 'Connect Telegram', 'Подключить телефон': 'Connect phone',
  'Поднеси телефон к музыке и нажми. Слушаю 12 секунд, плеер на это время встанет на паузу': 'Hold your phone to the music and tap. I listen for 12 seconds; the player pauses meanwhile',
  'Поиск не ответил. Проверь интернет': 'Search didn’t respond. Check your internet', 'Пока нет авторов': 'No artists yet', 'Пока нет. Нажми плюс, чтобы создать первый': 'None yet. Tap plus to create the first one',
  'Пока нечего проверять': 'Nothing to check yet', 'Пока нечего считать': 'Nothing to count yet', 'Пока ничего не нашлось. Послушай ещё немного и обнови подборку': 'Nothing yet. Listen a bit more and refresh the mix',
  'Пока пусто': 'Empty for now', 'Показать все треки': 'Show all tracks', 'Полная версия на месте': 'The full version is here', 'Понятно': 'Got it', 'Популярное': 'Popular',
  'Послушать 30 секунд': 'Listen to 30 seconds', 'Постов, которые нельзя исправить в канале': 'Posts that can’t be fixed in the channel',
  'Похожие артисты': 'Similar artists', 'Почти готово': 'Almost done', 'Появится, когда в библиотеке будет музыка': 'Appears once your library has music',
  'Превью 30 секунд': '30-second preview', 'Превью не загрузилось, проверь интернет': 'The preview didn’t load, check your internet', 'Принять': 'Accept', 'Принять все': 'Accept all',
  'Проверка названий': 'Title check', 'Проверь канал': 'Check the channel', 'Проверь сомнительные': 'Check doubtful ones', 'Проверяю…': 'Checking…', 'Просмотрено': 'Scanned',
  'Радио по треку «': 'Radio from “', 'Радио по этому треку': 'Radio from this track', 'Разделы': 'Sections', 'Разобрать': 'Parse',
  'Распознавание по звуку': 'Recognition by sound', 'Распознаю названия: осталось': 'Recognizing titles: left', 'Распознаю треки': 'Recognizing tracks', 'Распознаю…': 'Recognizing…',
  'Ровная громкость': 'Even volume', 'Ровно': 'Flat', 'Самые длинные': 'Longest', 'Сбросить': 'Reset', 'Сверено по звуку': 'Checked by sound', 'Свернуть': 'Collapse',
  'Свой ключ AudD (необязательно)': 'Your own AudD key (optional)', 'Сейчас': 'Now', 'Сейчас играет': 'Now playing',
  'Сейчас треки ищутся только по названию файла. По звуку получится точнее': 'Tracks are matched by file name only. By sound is more accurate',
  'Сервис текстов сейчас не отвечает. Попробуй чуть позже': 'The lyrics service isn’t responding. Try a bit later', 'Сервис тоже не узнал этот трек': 'The service didn’t recognize this track either',
  'Серые — нет в библиотеке: плюс или кнопка Telegram': 'Grey ones aren’t in your library: plus or the Telegram button', 'Синглы': 'Singles',
  'Синхронизация позже: нет связи': 'Sync later: no connection', 'Синхронизация: нужно войти в Telegram': 'Sync: log in to Telegram', 'Синхронизация: обнови плеер на этом устройстве': 'Sync: update the player on this device',
  'Синхронизирую…': 'Syncing…', 'Скачано': 'Downloaded', 'Скачивается': 'Downloading', 'Скопировано': 'Copied', 'Скопировать': 'Copy', 'Скопировать код': 'Copy code',
  'Скопировать название': 'Copy title', 'Скопировать название, чтобы найти и скачать': 'Copy the title to find and download it', 'Скопируй сюда': 'Copy here',
  'Следуй подсказкам на телефоне: иконка на экран «Домой», затем вход': 'Follow the hints on your phone: icon to the Home Screen, then log in',
  'Слушай музыку, и здесь появятся твои топ-артисты и треки': 'Listen to music and your top artists and tracks will appear here',
  'Слушать 12 секунд': 'Listen for 12 seconds', 'Слушать вперемешку': 'Shuffle play', 'Слушаю…': 'Listening…', 'Сменить бота': 'Change bot',
  'Сначала добавь музыку': 'Add music first', 'Сначала новые': 'Newest first', 'Сначала старые': 'Oldest first',
  'Сначала останавливаю текущую загрузку, выбери канал ещё раз через пару секунд': 'Stopping the current download first, choose the channel again in a few seconds',
  'Создай приложение: название': 'Create an app: name', 'Создать плейлист': 'Create playlist', 'Сообщение удалено из канала': 'The message was deleted from the channel',
  'Сортировка': 'Sorting', 'Сохранено': 'Saved', 'Сохранить': 'Save', 'Среди твоих треков': 'Among your tracks',
  'Срезать тишину в начале и конце треков, чтобы на стыке не было паузы': 'Trim silence at the start and end of tracks so there’s no gap between them',
  'Ссылка скопирована': 'Link copied', 'Сыграет следующим': 'Plays next', 'Твои сохранённые сообщения': 'Your saved messages', 'Твой номер': 'Your number',
  'Твоё и похожее': 'Yours and similar', 'Текст без привязки ко времени. Источник: LRCLIB': 'Unsynced lyrics. Source: LRCLIB',
  'Текст загрузится, когда появится интернет': 'Lyrics will load when you’re online', 'Текст песни': 'Lyrics', 'Текст: LRCLIB': 'Lyrics: LRCLIB',
  'Текста этой песни пока нет в базе': 'No lyrics for this song yet', 'Топ артистов': 'Top artists', 'Топ треков': 'Top tracks',
  'Точнее, но бесплатно только несколько раз в день': 'More accurate, but free only a few times a day', 'Трек ещё не скачан, а Telegram сейчас недоступен': 'The track isn’t downloaded and Telegram is unavailable',
  'Трек из другого канала': 'Track from another channel', 'Треки распознаются по звуку и по названию файла': 'Tracks are recognized by sound and file name',
  'Треки у тебя': 'Your tracks', 'Треков этого автора больше нет': 'No more tracks by this artist', 'Ты ещё ничего не слушал': 'You haven’t listened to anything yet',
  'У каждого свой Mix: вход через свой Telegram, своя музыка из своего канала, свои лайки и плейлисты. Твои данные он не увидит, а ты — его': 'Everyone has their own Mix: their own Telegram login, music from their own channel, own likes and playlists. They won’t see your data and you won’t see theirs',
  'У тебя включена двухэтапная проверка. Введи облачный пароль Telegram': 'Two-step verification is on. Enter your Telegram cloud password',
  'Убрано из «': 'Removed from “', 'Убрано из любимого': 'Removed from likes', 'Убрать из любимого': 'Unlike', 'Убрать из очереди': 'Remove from queue',
  'Убрать из плейлиста': 'Remove from playlist', 'Убрать из списка': 'Remove from list', 'Удалить «': 'Delete “', 'Удалить из библиотеки': 'Delete from library',
  'Удалить плейлист': 'Delete playlist', 'Удалить плейлист «': 'Delete playlist “', 'Удалить файл с устройства': 'Delete file from device',
  'Уже подключал Mix на компьютере?': 'Already connected Mix on a computer?', 'Умный микс': 'Smart mix', 'Устройства синхронизированы': 'Devices synced',
  'Файл удалён, трек скачается снова при прослушивании': 'File deleted, the track will download again when played', 'Файлы': 'Files', 'Хочу скачать': 'Wishlist',
  'Часто слушаю': 'On repeat', 'Часть постов обновить не вышло, попробую при следующем запуске': 'Some posts couldn’t be updated, will retry next launch',
  'Чаще слушаю': 'Most played', 'Читаю…': 'Reading…', 'Что играет?': 'What’s playing?', 'Что сейчас играет?': 'What’s playing now?', 'Эквалайзер': 'Equalizer',
  'Эти треки уже есть': 'These tracks are already here', 'Это идёт в фоне': 'This runs in the background', 'Это инструментальный трек, слов нет': 'This is an instrumental track, no lyrics',
  'Это не аудиофайлы': 'These aren’t audio files', 'Это он': 'That’s it', 'Это устройство уже подключено': 'This device is already connected',
  'Этого трека у тебя нет. Нажми плюс или кнопку Telegram': 'You don’t have this track. Tap plus or the Telegram button',
  'весь альбом': 'full album', 'нет в библиотеке': 'not in library', 'превью 30 секунд': '30-second preview', 'серые можно добавить через «Найти»': 'grey ones can be added via “Find”',
  'сингл': 'single', 'минут музыки': 'minutes of music', 'прослушиваний': 'plays', 'разных треков': 'different tracks', 'артистов': 'artists',
  'выкл': 'off', 'скачан': 'downloaded', 'совпадение': 'match', 'у тебя': 'yours', 'есть': 'have', 'из': 'of',
  // новые разделы
  'Настройки': 'Settings', 'Язык': 'Language', 'Воспроизведение': 'Playback', 'Распознавание': 'Recognition', 'Друзья': 'Friends', 'Память': 'Storage',
  'Слушать': 'Listen', 'О Mix': 'About Mix', 'О Mix и поддержка': 'About Mix and support', 'Вопросы, конфиденциальность, условия': 'FAQ, privacy, terms',
  'Mix для друга': 'Mix for a friend', 'Спокойное': 'Calm', 'Синхронизация': 'Sync', 'Синхронизировать сейчас': 'Sync now', 'Скорость': 'Speed', 'Обычная': 'Normal', 'Быстрее': 'Faster', 'Режим «экономия»': 'Battery saver', 'Работает': 'Working', 'Итоги года — картинка': 'Year in Mix — image', 'Поделиться «Сейчас слушаю»': 'Share “Now playing”', 'Энергичное': 'Energetic', 'Совместный плейлист': 'Shared playlist', 'совместный': 'shared', 'Ссылка-приглашение': 'Invite link', 'Открыть инструкцию': 'Open guide', 'Музыкальный бот': 'Music bot',
  'Распознавать заново': 'Recognize again', 'Ключ AcoustID для распознавания по звуку': 'AcoustID key for recognition by sound',
  'Плавный переход, срез тишины': 'Crossfade, silence trimming', 'Частоты под твои наушники': 'Frequencies for your headphones',
  'Кнопка «Найти» откроет этого бота с названием трека': 'The “Find” button opens this bot with the track title',
  'Отправь другу — там всё по шагам': 'Send it to a friend — everything is step by step',
};

// Числа со словами: «698 треков, 1937 мин» и т. п.
const PAT = [
  [/(\d[\d\s]*)\s(трек|трека|треков)(?![А-Яа-яЁё])/g, (m, n) => `${n.trim()} ${n.trim() === '1' ? 'track' : 'tracks'}`],
  [/(\d[\d\s]*)\s(автор|автора|авторов)(?![А-Яа-яЁё])/g, (m, n) => `${n.trim()} ${n.trim() === '1' ? 'artist' : 'artists'}`],
  [/(\d[\d\s]*)\s(альбом|альбома|альбомов)(?![А-Яа-яЁё])/g, (m, n) => `${n.trim()} ${n.trim() === '1' ? 'album' : 'albums'}`],
  [/(\d[\d\s]*)\s(синглов|сингла|сингл)(?![А-Яа-яЁё])/g, (m, n) => `${n.trim()} singles`],
  [/(\d+)\sмин(?![А-Яа-яЁё])/g, '$1 min'], [/На устройстве: ([\d,.]+) ГБ/g, 'On device: $1 GB'], [/Микс (\d+) с(?![А-Яа-яЁё])/g, 'Mix $1s'], [/(\d+) с(?![А-Яа-яЁё])/g, '$1 s'],
  [/есть (\d+) из (\d+)/g, 'have $1 of $2'], [/(?<![А-Яа-яЁё])есть (\d+)(?![А-Яа-яЁё])/g, 'have $1'], [/(\d+) раз(?![А-Яа-яЁё])/g, '$1×'], [/(\d+) повторов/g, '$1 duplicates'], [/(\d+) копии/g, '$1 copies'],
  [/Распознаю названия: осталось (\d+)/g, 'Recognizing titles: $1 left'], [/Сверено по звуку: (\d+)/g, 'Checked by sound: $1'], [/осталось (\d+)/g, '$1 left'],
  [/Не скачано: (\d+), проверятся после скачивания/g, 'Not downloaded: $1, will be checked after download'],
  [/Дискография: (\d+) (альбом|альбомов|альбома)/g, 'Discography: $1 albums'], [/, (\d+) синглов/g, ', $1 singles'],
  [/Показать все треки \((\d+)\)/g, 'Show all tracks ($1)'], [/Принять все \((\d+)\)/g, 'Accept all ($1)'], [/Не распознаны: (\d+)/g, 'Not recognized: $1'],
  [/Не хватает: (\d+)/g, 'Missing: $1'], [/Проверь сомнительные: (\d+)/g, 'Check doubtful ones: $1'], [/Исправлено само: (\d+)/g, 'Fixed automatically: $1'],
  [/Ищу заново: (.+)\. Это идёт в фоне/g, 'Searching again: $1. Runs in the background'], [/Треки у тебя: (\d+)/g, 'Your tracks: $1'],
  [/У тебя есть (\d+), нет (\d+)/g, 'You have $1, missing $2'], [/(\d+) песен\./g, '$1 songs.'], [/ · у тебя /g, ' · yours: '], [/ · сингл/g, ' · single'], [/новое · /g, 'new · '],
];
const LONG = Object.keys(EN).filter(k => k.length >= 14).sort((a, b) => b.length - a.length);
// где лежат названия треков, артистов, альбомов: там переводим только целую строку из словаря
const CONTENT = '.ttl, .t, .a, #npTitle, #npArtist, #fTitle, #fArtist, .lyrics, .album b, .artist b, .arthead b, .was, .is, .fnext, .qrow .ttl, #viewTitle';
const CYR = /[А-Яа-яЁё]/;

export function tr(s) {
  if (!s || !CYR.test(s)) return s;
  const t = s.trim(); if (EN[t]) return s.replace(t, EN[t]);
  let out = s;
  for (const [re, to] of PAT) out = out.replace(re, to); // сначала числа со словами, потом длинные фразы
  for (const k of LONG) if (out.includes(k)) out = out.split(k).join(EN[k]);
  return out;
}
function trText(node) {
  const v = node.nodeValue; if (!v || !CYR.test(v)) return;
  const inContent = !node.parentElement?.closest('#viewSub') && node.parentElement?.closest(CONTENT);
  const t = v.trim();
  if (inContent) {
    // заголовок экрана — словарь (Вся музыка, Альбомы…), а названия альбомов/плейлистов не трогаем
    if (EN[t]) node.nodeValue = v.replace(t, EN[t]);
    else if (node.parentElement?.closest('#viewTitle, .a, .is')) { const n = v.replace(/\b(\d[\d\s]*)\s(трек|трека|треков)\b(?![А-Яа-яЁё])/g, (m, x) => `${x.trim()} tracks`); if (n !== v) node.nodeValue = n; }
    return;
  }
  const n = tr(v); if (n !== v) node.nodeValue = n;
}
const ATTRS = ['title', 'placeholder', 'aria-label'];
function trEl(el) {
  for (const a of ATTRS) { const v = el.getAttribute?.(a); if (v && CYR.test(v)) el.setAttribute(a, tr(v)); }
}
function walk(root) {
  if (root.nodeType === 3) return trText(root);
  if (root.nodeType !== 1) return;
  trEl(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = w.nextNode(); n; n = w.nextNode()) n.nodeType === 3 ? trText(n) : trEl(n);
}
let obs = null;
export function setLang(lang) {
  document.documentElement.lang = lang === 'en' ? 'en' : 'ru';
  obs?.disconnect(); obs = null;
  if (lang !== 'en') return;
  walk(document.body);
  obs = new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'characterData') trText(m.target);
      else if (m.type === 'attributes') trEl(m.target);
      else for (const n of m.addedNodes) walk(n);
    }
  });
  obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  // системные окна подтверждения тоже на английском
  const c = window.confirm; window.confirm = msg => c.call(window, tr(String(msg)));
}
export const defaultLang = () => (navigator.language || '').toLowerCase().startsWith('ru') ? 'ru' : 'en';
