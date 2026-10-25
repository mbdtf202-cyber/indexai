/**
 * Event Quality Scoring & Clustering (T6.6)
 * 
 * Label, validate, and deduplicate AI events across multiple sources
 */

// Event classification rules
export const EVENT_RULES = {
  // Activity morphology terms that indicate AI events
  activity_terms: [
    'hackathon', 'conference', 'meetup', 'summit', 'workshop',
    'ai event', 'ml conference', 'deep learning', 'chatbot',
    'llm', 'model release', 'benchmark', 'competition',
  ],
  
  // AI-specific indicators
  ai_indicators: [
    'artificial intelligence', 'machine learning', 'neural network',
    'generative ai', 'large language model', 'gpts',
  ],
};

// Known regions mapping (ISO country codes → display names)
export const REGION_DICTIONARY = {
  'CN': { en: 'China', zh: '中国大陆', alpha2: 'CN', is_mainland: true },
  'HK': { en: 'Hong Kong', zh: '香港', alpha2: 'HK', is_mainland: false },
  'TW': { en: 'Taiwan', zh: '台湾', alpha2: 'TW', is_mainland: false },
  'US': { en: 'United States', zh: '美国', alpha2: 'US', is_mainland: false },
  'JP': { en: 'Japan', zh: '日本', alpha2: 'JP', is_mainland: false },
  'KR': { en: 'South Korea', zh: '韩国', alpha2: 'KR', is_mainland: false },
  'UK': { en: 'United Kingdom', zh: '英国', alpha2: 'UK', is_mainland: false },
  default: { en: 'Unknown', zh: '未知', alpha2: 'ZZ', is_mainland: false },
};

// Normalization functions
export function normalizeUrl(url) {
  if (!url) return '';
  
  try {
    const parsed = new URL(url);
    
    // Remove common tracking parameters
    const cleanParams = ['utm_source', 'utm_medium', 'utm_campaign', 'fbclid', 'gclid'];
    for (const param of cleanParams) {
      parsed.searchParams.delete(param);
    }
    
    // Normalize path
    let pathname = parsed.pathname;
    if (pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    
    return `${parsed.protocol}//${parsed.hostname}${pathname}${parsed.search}`;
  } catch {
    return url.toLowerCase().trim();
  }
}

export function extractRegion(text, knownLocations) {
  // Priority 1: Try ISO codes from database
  for (const [code, region] of Object.entries(REGION_DICTIONARY)) {
    if (text.includes(region.alpha2) || text.includes(code)) {
      return code;
    }
  }
  
  // Priority 2: Match against provided location database
  if (knownLocations) {
    for (const loc of knownLocations) {
      if (text.includes(loc.city) || text.includes(loc.name)) {
        return loc.country_code;
      }
    }
  }
  
  // Fallback: unknown region
  return 'ZZ';
}

// AI relevance scoring
export function calculateAiRelevance(title, description) {
  const combined = `${title} ${description}`.toLowerCase();
  let score = 0;
  const matchedBy = [];
  
  // Check activity terms
  for (const term of EVENT_RULES.activity_terms) {
    if (combined.includes(term)) {
      score += 5;
      matchedBy.push(`activity:${term}`);
    }
  }
  
  // Check AI indicators
  for (const indicator of EVENT_RULES.ai_indicators) {
    if (combined.includes(indicator)) {
      score += 10;
      matchedBy.push(`ai:${indicator}`);
    }
  }
  
  return {
    score,
    matchedBy: [...new Set(matchedBy)], // Unique matches only
    is_ai_event: score >= 10,
  };
}

// Cross-source deduplication
export function findDuplicates(events, options = {}) {
  const { dateThreshold = 1, cityThreshold = true } = options;
  
  const normalized = events.map(e => ({
    ...e,
    url_normalized: normalizeUrl(e.url),
    region: e.region || extractRegion(e.title, e.locations),
  }));
  
  const duplicates = [];
  const processed = new Set();
  
  for (let i = 0; i < normalized.length; i++) {
    if (processed.has(i)) continue;
    
    const current = normalized[i];
    const matches = [];
    
    for (let j = i + 1; j < normalized.length; j++) {
      if (processed.has(j)) continue;
      
      const other = normalized[j];
      
      // Check title similarity (simple prefix match)
      const titleSimilar = current.title?.length >= 10 && 
                          current.title.toLowerCase().startsWith(other.title.toLowerCase().slice(0, 10));
      
      // Check date proximity
      const dateDiff = Math.abs(
        new Date(current.date).getTime() - new Date(other.date).getTime()
      );
      const sameDay = dateDiff < dateThreshold * 24 * 60 * 60 * 1000;
      
      // Check city match
      const sameCity = !cityThreshold || 
                      (current.region === other.region && current.city === other.city);
      
      // URL normalization match
      const sameSource = current.url_normalized === other.url_normalized;
      
      if ((sameSource || (titleSimilar && sameDay && sameCity))) {
        matches.push(j);
      }
    }
    
    if (matches.length > 0) {
      duplicates.push({
        primary_index: i,
        duplicate_indices: matches,
        event_id: current.id,
        urls: [current.url, ...matches.map(idx => normalized[idx].url)],
      });
      matches.forEach(m => processed.add(m));
    }
    
    processed.add(i);
  }
  
  return duplicates;
}

// ICS calendar generation
export function generateICSFeed(events) {
  const now = new Date().toISOString();
  
  let ics = `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//IndexAI//Event Calendar//EN\nCALSCALE:GREGORIAN\nMETHOD:PUBLISH\n`;
  
  for (const event of events) {
    const startDate = event.date ? new Date(event.date).toISOString().replace(/[-:]/g, '').split('.')[0] : now;
    
    ics += `BEGIN:VEVENT\n`;
    ics += `UID:${event.id}@indexai.pages.dev\n`;
    ics += `DTSTAMP:${now}\n`;
    ics += `DTSTART:${startDate}\n`;
    ics += `SUMMARY:${escapeICS(event.title)}\n`;
    
    if (event.description) {
      ics += `DESCRIPTION:${escapeICS(event.description)}\n`;
    }
    
    if (event.url) {
      ics += `URL:${escapeICS(event.url)}\n`;
    }
    
    if (event.location) {
      ics += `LOCATION:${escapeICS(event.location)}\n`;
    }
    
    if (event.tags) {
      ics += `CATEGORIES:${event.tags.join(',')}\n`;
    }
    
    ics += `END:VEVENT\n`;
  }
  
  ics += `END:VCALENDAR`;
  return ics;
}

// Escape special characters for ICS format
function escapeICS(text) {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

// Quality scoring thresholds
export const QUALITY_THRESHOLDS = {
  min_score: 10,          // Minimum AI relevance score
  max_duplicates_percent: 1, // Maximum allowed duplicate rate
  min_sources: 3,         // Minimum unique sources required
};

export function validateQuality(events, duplicates) {
  const total = events.length;
  const duplicated = duplicates.reduce((sum, d) => sum + d.duplicate_indices.length, 0);
  const duplicate_rate = total > 0 ? (duplicated / total * 100).toFixed(2) : 0;
  
  const validEvents = events.filter(e => 
    calculateAiRelevance(e.title, e.description).is_ai_event
  );
  
  const quality_report = {
    total_events: total,
    valid_ai_events: validEvents.length,
    accuracy_percent: total > 0 ? (validEvents.length / total * 100).toFixed(1) : 0,
    duplicate_rate: `${duplicate_rate}%`,
    within_threshold: parseFloat(duplicate_rate) < QUALITY_THRESHOLDS.max_duplicates_percent,
    passes_quality_line: duplicate_rate < QUALITY_THRESHOLDS.max_duplicates_percent,
  };
  
  return quality_report;
}

// Export utility for CLI usage
export function parseQualityParams(params) {
  const minScore = parseInt(params.get('min_score')) || QUALITY_THRESHOLDS.min_score;
  const maxDups = parseFloat(params.get('max_duplicates')) || QUALITY_THRESHOLDS.max_duplicates_percent;
  
  return {
    min_ai_score: minScore,
    max_duplicate_rate: maxDups,
    validate_only: params.get('validate') === 'true',
  };
}

export default {
  normalizeUrl,
  extractRegion,
  calculateAiRelevance,
  findDuplicates,
  generateICSFeed,
  validateQuality,
  parseQualityParams,
  EVENT_RULES,
  REGION_DICTIONARY,
  QUALITY_THRESHOLDS,
};
