const film = document.querySelector('#guide-film');
const chapter = document.querySelector('#chapter');
document.querySelector('#chapter-controls').hidden = false;
chapter.addEventListener('change', () => {
  film.currentTime = Number(chapter.value);
  film.play().catch(() => { /* Native player controls remain available. */ });
});
film.addEventListener('timeupdate', () => {
  const chapters = Array.from(chapter.options);
  const active = chapters.filter(option => Number(option.value) <= film.currentTime).pop();
  if (active && document.activeElement !== chapter) chapter.value = active.value;
});

const topics = Array.from(document.querySelectorAll('.topics a'));
const image = document.querySelector('#card-image');
for (const topic of topics) {
  topic.addEventListener('click', event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const number = topic.querySelector('span').textContent;
    const title = topic.textContent.slice(number.length).trim();
    for (const link of topics) link.removeAttribute('aria-current');
    topic.setAttribute('aria-current', 'true');
    image.src = topic.href;
    image.alt = 'Feature card ' + number + ': ' + title + '. Open the full-size PNG.';
    document.querySelector('#card-full').href = topic.href;
    document.querySelector('#card-download').href = topic.href;
    document.querySelector('#card-caption').textContent = number + ' / ' + title;
  });
}
