// Настройки, которые может понадобиться поменять руками.
export const CONFIG = {
  // Адрес портала LEXI — сюда ведёт кнопка «← LEXI» в шапке.
  portalUrl: 'https://lexi-ecosystem.netlify.app/',

  // Группы спутников, которые грузятся сразу (остальные — по нажатию на слой)
  preload: ['stations', 'gps-ops', 'glo-ops', 'galileo', 'weather', 'science'],

  // Как часто пересчитывать живые показатели, мс
  every: { saa: 10e3, gnss: 30e3, kp: 15 * 60e3, tle: 60e3 },

  // Точка наблюдения по умолчанию, пока не разрешена геолокация
  defaultPlace: { lat: 55.7558, lon: 37.6173, ru: 'Москва', en: 'Moscow' },
};
