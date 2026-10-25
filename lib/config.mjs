// Configuration constants (T5.10, F52)
export const SITE = {
  BASE_URL: process.env.SITE_BASE_URL || 'https://indexai.pages.dev',
  FEED_PATH: 'feeds/changes.xml',
  CANONICAL: () => `${SITE.BASE_URL}/`,
  CHANGE_FEED: () => `${SITE.BASE_URL}/${SITE.FEED_PATH}`,
};

export default { SITE };
