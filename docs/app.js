'use strict';

const el = id => document.getElementById(id);
let database;
let currentBook;
let editingId;
let lastAuthor = {};
let pageIndex = 0;
let previewPages = [];
let assetUrls = [];
let routeVersion = 0;
let toastTimer;

function toast(message) {
  el('status').textContent = message;
  el('status').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el('status').hidden = true; }, 6000);
}
function report(error) {
  console.error(error);
  toast('Не удалось открыть или сохранить книгу. Проверьте, разрешено ли хранение данных в браузере.');
}
function openDatabase() {
  return new Promise((resolve, reject) => {
    // Reuse the first demo's store to preserve books created before this update.
    const request = indexedDB.open('na-pamyat', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('books');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function readBooks(id) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('books', 'readonly');
    const store = transaction.objectStore('books');
    const request = id ? store.get(id) : store.getAll();
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
async function changeBook(id, update) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('books', 'readwrite');
    const store = transaction.objectStore('books');
    let result;
    const request = store.get(id);
    request.onsuccess = () => {
      try {
        result = update(request.result ? normalizeBook(request.result, id) : undefined);
        if (!result) throw new Error('Книга не найдена');
        result.updatedAt = Date.now();
        store.put(result, id);
      } catch (error) {
        transaction.abort();
        reject(error);
      }
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
function normalizeBook(value, id) {
  return {
    ...value,
    id: value.id || id,
    title: value.title || value.name + '. Истории близких',
    order: value.order || 'manual',
    format: value.format || 'square',
    cover: value.cover || 'olive',
    entries: (value.entries || []).map((entry, index) => ({
      ...entry,
      id: entry.id || 'legacy-' + index,
      title: entry.title || entry.dish || '',
      method: entry.method || entry.recipe || ''
    }))
  };
}
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function button(text, action, className = 'link-button') {
  const element = node('button', text, className);
  element.type = 'button';
  element.onclick = () => Promise.resolve().then(action).catch(report);
  return element;
}
function clearAssets() {
  assetUrls.forEach(url => URL.revokeObjectURL(url));
  assetUrls = [];
}
function imageUrl(blob) {
  const url = URL.createObjectURL(blob);
  assetUrls.push(url);
  return url;
}
function year(entry) {
  return Number((entry.date || '').match(/\b(?:18|19|20)\d{2}\b/)?.[0] || Infinity);
}
function orderedEntries(book) {
  const entries = [...book.entries];
  if (book.order === 'author') entries.sort((a,b) => a.author.localeCompare(b.author, 'ru'));
  if (book.order === 'date') entries.sort((a,b) => year(a) - year(b));
  return entries;
}
function bookLink(view, id = currentBook?.id) {
  return '#' + view + (id ? '/' + encodeURIComponent(id) : '');
}
function navigate(view, id) {
  location.hash = bookLink(view, id);
}
async function route() {
  const version = ++routeVersion;
  const [requestedView, encodedId] = location.hash.slice(1).split('/');
  const known = ['home','books','new','studio','contribute','preview','example'];
  const view = known.includes(requestedView) ? requestedView : 'home';
  let book;
  if (['studio','contribute','preview'].includes(view)) {
    const id = encodedId ? decodeURIComponent(encodedId) : '';
    const stored = id ? await readBooks(id) : undefined;
    if (version !== routeVersion) return;
    if (!stored) {
      toast('Эта книга не найдена в этом браузере.');
      navigate('books', '');
      return;
    }
    book = normalizeBook(stored, id);
  }
  if (version !== routeVersion) return;
  clearAssets();
  currentBook = book;
  for (const section of document.querySelectorAll('.view')) section.hidden = section.id !== view;
  if (view === 'books') await renderBooks(version);
  if (view === 'studio') renderStudio();
  if (view === 'contribute') renderForm();
  if (view === 'preview') renderPreview();
  window.scrollTo({top:0});
}
async function renderBooks(version) {
  const db = await database;
  // Older records use out-of-line keys, so getAllKeys preserves their identifiers.
  const books = await new Promise((resolve, reject) => {
    const transaction = db.transaction('books', 'readonly');
    const store = transaction.objectStore('books');
    const values = store.getAll();
    const keys = store.getAllKeys();
    transaction.oncomplete = () => resolve(values.result.map((value,index) => normalizeBook(value, keys.result[index])));
    transaction.onerror = () => reject(transaction.error);
  });
  if (version !== routeVersion) return;
  const list = el('bookList');
  list.replaceChildren();
  books.sort((a,b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (!books.length) {
    const empty = node('div', undefined, 'empty');
    empty.append(node('h3','Ваша первая семейная книга'),node('p','Начните с имени близкого человека или откройте вымышленный пример.'));
    const link = node('a','Попробовать пример ↗','button secondary');
    link.href = '#example';
    empty.append(link);
    list.append(empty);
  }
  for (const book of books) {
    const card = node('a', undefined, 'book-card');
    card.href = bookLink('studio', book.id);
    const cover = node('div', book.title, 'mini-cover');
    cover.style.background = coverColor(book.cover);
    card.append(cover,node('h3', book.title), node('p', 'Материалы — ' + book.entries.length + ' · день рождения', 'muted'));
    list.append(card);
  }
}
function coverColor(cover) {
  return ({olive:'#414e36', wine:'#713e47', sand:'#857451'})[cover] || '#414e36';
}
function renderStudio() {
  el('studioTitle').textContent = currentBook.title;
  const authors = new Set(currentBook.entries.map(entry => entry.author.trim().toLocaleLowerCase('ru')));
  el('studioMeta').textContent = 'Материалы — ' + currentBook.entries.length + ' · участники — ' + authors.size +
    (currentBook.occasionDate ? ' · к ' + new Date(currentBook.occasionDate + 'T12:00:00').toLocaleDateString('ru-RU') : '');
  el('order').value = currentBook.order;
  el('cover').value = currentBook.cover;
  el('format').value = currentBook.format;
  const list = el('entryList');
  list.replaceChildren();
  if (!currentBook.entries.length) {
    const empty = node('div', undefined, 'empty');
    empty.append(node('h3','Здесь начинается книга'),node('p','Добавьте первую историю от себя или попробуйте форму от лица близкого.'), button('Добавить воспоминание ↗', startContribution, 'button secondary'));
    list.append(empty);
  }
  for (const entry of orderedEntries(currentBook)) {
    const card = node('article', undefined, 'entry-card');
    card.append(node('p',[entry.author,entry.relation,entry.date].filter(Boolean).join(' · '),'entry-meta'));
    card.append(node('h3',entry.title || (entry.kind === 'recipe' ? 'Семейный рецепт' : 'Воспоминание')));
    const content = entry.kind === 'recipe' ? [entry.memory,entry.ingredients,entry.method].filter(Boolean).join('\n\n') : entry.story;
    card.append(node('p', content || 'Аудиоистория — запись можно прослушать ниже.'));
    if (entry.picture) {
      const image = node('img');
      image.className = 'entry-image';
      image.src = imageUrl(entry.picture);
      image.alt = entry.caption || 'Изображение к воспоминанию';
      card.append(image);
      if (entry.caption) card.append(node('p',entry.caption,'muted'));
    }
    if (entry.audio) {
      const audio = node('audio');
      audio.controls = true;
      audio.src = imageUrl(entry.audio);
      card.append(audio);
    }
    const actions = node('div', undefined, 'entry-actions');
    actions.append(button('Редактировать', () => {
      editingId = entry.id;
      navigate('contribute', currentBook.id);
    }));
    for (const [offset, label] of [[-1,'↑ Выше'],[1,'↓ Ниже']]) {
      const index = currentBook.entries.findIndex(item => item.id === entry.id);
      const target = index + offset;
      const move = button(label, async () => {
        const id = currentBook.id;
        await changeBook(id, book => {
          const position = book.entries.findIndex(item => item.id === entry.id);
          const destination = position + offset;
          if (destination >= 0 && destination < book.entries.length) {
            [book.entries[position],book.entries[destination]] = [book.entries[destination],book.entries[position]];
          }
          return book;
        });
        await route();
      });
      move.disabled = currentBook.order !== 'manual' || target < 0 || target >= currentBook.entries.length;
      actions.append(move);
    }
    actions.append(button('Удалить', async () => {
      if (!confirm('Удалить это воспоминание из книги?')) return;
      await changeBook(currentBook.id, book => {
        book.entries = book.entries.filter(item => item.id !== entry.id);
        return book;
      });
      await route();
    }, 'link-button danger'));
    card.append(actions);
    list.append(card);
  }
}
function startContribution() {
  editingId = undefined;
  lastAuthor = {};
  navigate('contribute', currentBook.id);
}
function chooseKind() {
  const recipe = el('entryKind').value === 'recipe';
  el('storyFields').hidden = recipe;
  el('recipeFields').hidden = !recipe;
}
function renderForm() {
  const form = el('entryForm');
  form.reset();
  el('entryError').textContent = '';
  form.hidden = false;
  el('savedEntry').hidden = true;
  el('contributeTitle').textContent = currentBook.name + ' · воспоминания близких';
  el('contributePrompt').textContent = currentBook.prompt || 'Смешной случай, важный момент или блюдо из детства. Что хочется сохранить?';
  el('contributionBack').href = bookLink('studio');
  const entry = editingId ? currentBook.entries.find(item => item.id === editingId) : undefined;
  if (editingId && !entry) editingId = undefined;
  for (const option of el('entryKind').options) option.disabled = currentBook.mode !== 'both' && currentBook.mode !== option.value;
  el('entryKind').value = currentBook.mode === 'recipe' ? 'recipe' : 'story';
  for (const [key,value] of Object.entries(entry || lastAuthor)) {
    const field = form.elements.namedItem(key);
    if (field && typeof value === 'string' && field.type !== 'file' && field.type !== 'checkbox') field.value = value;
  }
  el('saveEntry').textContent = entry ? 'Сохранить изменения' : 'Сохранить воспоминание';
  el('existingFiles').textContent = [
    entry?.picture ? 'Прикреплено изображение' : '',
    entry?.audio ? 'Прикреплено аудио' : ''
  ].filter(Boolean).join(' · ');
  el('removePictureLabel').hidden = !entry?.picture;
  el('removeAudioLabel').hidden = !entry?.audio;
  chooseKind();
}
function paginateText(text, limit = 1200) {
  if (!text) return [''];
  const chunks = [];
  let rest = text;
  while (rest.length > limit) {
    const boundary = Math.max(rest.lastIndexOf('\n',limit),rest.lastIndexOf(' ',limit));
    const split = boundary > limit / 2 ? boundary : limit;
    chunks.push(rest.slice(0,split));
    rest = rest.slice(split).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}
function renderPreview() {
  pageIndex = 0;
  el('previewTitle').textContent = currentBook.title;
  el('previewBack').href = bookLink('studio');
  el('bookSpread').classList.toggle('portrait',currentBook.format === 'portrait');
  previewPages = [{cover:true,title:currentBook.title,body:'Истории, которые собрали близкие',extra:currentBook.occasionDate || ''}];
  for (const entry of orderedEntries(currentBook)) {
    const recipe = entry.kind === 'recipe';
    const content = recipe ? [
      entry.memory,
      entry.ingredients ? 'Ингредиенты\n' + entry.ingredients : '',
      entry.method ? 'Как приготовить\n' + entry.method : ''
    ].filter(Boolean).join('\n\n') : entry.story || 'К этой истории прикреплена аудиозапись. Добавьте текст перед подготовкой к печати.';
    const parts = paginateText(content, entry.picture ? 800 : 1200);
    parts.forEach((body,index) => previewPages.push({
      title:(entry.title || (recipe ? 'Семейный рецепт' : 'Воспоминание')) + (index ? ' · продолжение' : ''),
      eyebrow: [entry.author,entry.relation].filter(Boolean).join(' · '),
      body,
      extra:entry.date,
      recipe,
      picture:index === 0 ? entry.picture : undefined,
      caption:entry.caption
    }));
  }
  if (previewPages.length === 1) previewPages.push({title:'Первое воспоминание ещё впереди',body:'Добавьте историю или рецепт, и они появятся на этих страницах.'});
  paintSpread();
}
function paintSpread() {
  const root = el('bookSpread');
  root.replaceChildren();
  clearAssets();
  for (const [index,page] of previewPages.slice(pageIndex,pageIndex+2).entries()) {
    const article = node('article',undefined,'book-page' + (page.cover ? ' book-cover' : '') + (page.recipe ? ' recipe-page' : ''));
    if (page.cover) article.style.background = coverColor(currentBook.cover);
    article.append(node('p',page.cover ? 'СЕМЕЙНАЯ КНИГА' : page.eyebrow,'eyebrow'),node('h2',page.title),node('p',page.body));
    if (page.picture) {
      const image = node('img');
      image.src = imageUrl(page.picture);
      image.alt = page.caption || 'Изображение к истории';
      article.append(image);
      if (page.caption) article.append(node('p',page.caption,'muted'));
    }
    if (page.extra) article.append(node('p',page.extra,'muted'));
    article.append(node('p',String(pageIndex+index+1),'muted'));
    root.append(article);
  }
  el('previousPage').disabled = pageIndex === 0;
  el('nextPage').disabled = pageIndex + 2 >= previewPages.length;
  el('pageStatus').textContent = (pageIndex+1) + '–' + Math.min(pageIndex+2,previewPages.length) + ' из ' + previewPages.length;
}
async function saveSetting(event) {
  const id = currentBook.id;
  const key = event.target.id;
  const value = event.target.value;
  await changeBook(id, book => ({...book,[key]:value}));
  await route();
}
el('createBook').onsubmit = async event => {
  event.preventDefault();
  const createForm = event.currentTarget;
  const data = Object.fromEntries(new FormData(createForm));
  data.name = data.name.trim();
  if (!data.name) {
    event.currentTarget.elements.name.focus();
    return;
  }
  const submit = event.currentTarget.querySelector('button');
  submit.disabled = true;
  try {
    const id = crypto.randomUUID();
    await changeBook(id,() => ({
      ...data,id,title:data.title.trim() || data.name + '. Истории близких',
      cover:'olive',format:'square',order:'manual',entries:[],createdAt:Date.now()
    }));
    createForm.reset();
    navigate('studio',id);
  } catch (error) { report(error); }
  finally { submit.disabled = false; }
};
el('entryForm').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const error = el('entryError');
  error.textContent = '';
  for (const key of Object.keys(data)) if (typeof data[key] === 'string') data[key] = data[key].trim();
  const existing = editingId ? currentBook.entries.find(entry => entry.id === editingId) : undefined;
  for (const key of ['picture','audio']) {
    const file = data[key];
    if (file?.size) {
      if (file.size > 10*1024*1024) {
        error.textContent = 'Каждый файл должен быть размером до 10 МБ.';
        return;
      }
      if (key === 'picture' && !['image/jpeg','image/png','image/webp'].includes(file.type)) {
        error.textContent = 'Выберите изображение JPG, PNG или WebP.';
        return;
      }
      if (key === 'audio' && file.type && !file.type.startsWith('audio/')) {
        error.textContent = 'Выберите аудиофайл.';
        return;
      }
    } else data[key] = existing?.[key];
  }
  if (data.removePicture) delete data.picture;
  if (data.removeAudio) delete data.audio;
  delete data.removePicture;
  delete data.removeAudio;
  if (data.kind === 'story') {
    delete data.memory;
    delete data.ingredients;
    delete data.method;
  } else {
    delete data.story;
    delete data.audio;
  }
  if (!data.author || !data.relation) {
    error.textContent = 'Укажите, как вас подписать и кем вы приходитесь герою книги.';
    return;
  }
  const hasContent = data.kind === 'story' ? data.story || data.audio : data.ingredients || data.method || data.picture;
  if (!hasContent) {
    error.textContent = data.kind === 'story' ? 'Напишите историю или добавьте аудиозапись.' : 'Добавьте ингредиенты, способ приготовления или фотографию рецепта.';
    return;
  }
  const submit = el('saveEntry');
  submit.disabled = true;
  const id = currentBook.id;
  data.id = editingId || crypto.randomUUID();
  try {
    await changeBook(id,book => {
      const index = book.entries.findIndex(entry => entry.id === data.id);
      if (editingId && index < 0) throw new Error('История удалена в другой вкладке');
      if (index >= 0) book.entries[index] = data;
      else book.entries.push(data);
      return book;
    });
    lastAuthor = {author:data.author,relation:data.relation};
    editingId = undefined;
    form.hidden = true;
    el('savedEntry').hidden = false;
    el('savedEntry').scrollIntoView({behavior:'smooth',block:'center'});
  } catch (exception) {
    console.error(exception);
    error.textContent = 'Сохранение не удалось. Попробуйте ещё раз или выберите файлы меньшего размера.';
  } finally { submit.disabled = false; }
};
el('entryKind').onchange = chooseKind;
el('openContribution').onclick = startContribution;
el('openInvitation').onclick = startContribution;
el('openPreview').onclick = () => navigate('preview',currentBook.id);
el('cancelEntry').onclick = () => navigate('studio',currentBook.id);
el('finishContribution').onclick = () => navigate('studio',currentBook.id);
el('anotherEntry').onclick = () => {
  renderForm();
  window.scrollTo({top:0,behavior:'smooth'});
};
for (const key of ['order','cover','format']) el(key).onchange = event => saveSetting(event).catch(report);
el('previousPage').onclick = () => { pageIndex -= 2; paintSpread(); };
el('nextPage').onclick = () => { pageIndex += 2; paintSpread(); };
el('loadExample').onclick = async () => {
  el('loadExample').disabled = true;
  try {
    const id = 'demo-nina';
    await changeBook(id, previous => previous || {
      id,name:'Нина',title:'Рассказы о Нине',mode:'both',prompt:'Вспомните смешной случай на даче или любимое блюдо Нины.',order:'manual',cover:'olive',format:'square',entries:[
        {id:'nina-story',kind:'story',title:'Пирог, который сбежал',author:'Лена',relation:'Подруга детства',date:'Лето 1998 года',story:'Однажды Нина оставила пирог остывать у окна. Мы вернулись к столу, а от пирога осталась одна корочка. На подоконнике сидел кот и невозмутимо мыл лапу.\n\n«Ну хоть тарелку оставил», — сказала Нина и принесла варенье к чаю.'},
        {id:'nina-recipe',kind:'recipe',title:'Яблочный пирог',author:'Лена',relation:'Подруга детства',date:'',memory:'Этот пирог мы ели ещё тёплым, на крыльце.',ingredients:'3 яблока\n3 яйца\nСтакан муки\nСтакан сахара',method:'Взбить яйца с сахаром, добавить муку. Выложить яблоки в форму и залить тестом. Выпекать около 35 минут при 180 °C.'}
      ]
    });
    navigate('studio',id);
  } catch (error) { report(error); }
  finally { el('loadExample').disabled = false; }
};
window.addEventListener('hashchange',() => route().catch(report));
database = openDatabase();
// Attach a rejection handler immediately, including on the landing page.
database.catch(report);
route().catch(report);
