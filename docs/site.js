const film = document.querySelector('#guide-film');
const chapter = document.querySelector('#chapter');
const playGuide = document.querySelector('#play-guide');
// Without JS the poster and the native controls still work.
playGuide.hidden = false;
film.controls = false;
function showPlayer() {
  film.controls = true;
  playGuide.hidden = true;
}
playGuide.addEventListener('click', () => {
  showPlayer();
  film.focus({preventScroll: true});
  film.play().catch(() => { /* Leave native controls available for retry. */ });
});
film.addEventListener('play', showPlayer, {once: true});
document.querySelector('#chapter-controls').hidden = false;
chapter.addEventListener('change', () => {
  showPlayer();
  film.currentTime = Number(chapter.value);
  film.play().catch(() => { /* Native player controls remain available. */ });
});
film.addEventListener('timeupdate', () => {
  const chapters = Array.from(chapter.options);
  const active = chapters.filter(option => Number(option.value) <= film.currentTime).pop();
  if (active && document.activeElement !== chapter) chapter.value = active.value;
});

// Fragment links select the card even when JS is unavailable; this only marks the topic.
const topics = [...document.querySelectorAll('.topics a')];
function markCurrentTopic() {
  const current = topics.find(link => link.hash === location.hash) || topics[0];
  for (const link of topics) {
    if (link === current) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  }
}
markCurrentTopic();
window.addEventListener('hashchange', markCurrentTopic);
