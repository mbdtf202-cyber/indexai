/**
 * Relay Gateway History & Availability Tracking (T6.7)
 * 
 * Track relay gateway changes, availability rates, and price template grouping
 */
import { HOST } from './config.js';
import { now, nowISO } from './clock.js';

// Default price templates based on common pricing patterns
export const PRICE_TEMPLATES = {
  'standard': {
    name: 'Standard AI Pricing',
    input_range: [0.2, 5.0],
    output_range: [0.6, 15.0],
    description: 'Most common AI model pricing tier',
  },
  'premium': {
    name: 'Premium Tier',
    input_range: [5.0, 30.0],
    output_range: [15.0, 60.0],
    description: 'Enterprise-grade AI pricing',
  },
  'budget': {
    name: 'Budget Tier',
    input_range: [0.01, 0.2],
    output_range: [0.03, 0.6],
    description: 'Low-cost AI processing',
  },
};

/**
 * Classify price into template category
 */
export function classifyPriceTemplate(input_price, output_price) {
  const total = (input_price || 0) + (output_price || 0);
  
  if (total <= 2.0) return 'budget';
  if (total <= 35.0) return 'standard';
  return 'premium';
}

/**
 * Group relays by price template similarity
 */
export function groupByPriceTemplate(relays) {
  const groups = {};
  
  for (const relay of relays) {
    const template = classifyPriceTemplate(
      relay.input_price || relay.base_input_price,
      relay.output_price || relay.base_output_price
    );
    
    if (!groups[template]) {
      groups[template] = [];
    }
    
    groups[template].push({
      ...relay,
      normalized_template: template,
    });
  }
  
  // Add group summary
  for (const [template, items] of Object.entries(groups)) {
    const templateInfo = PRICE_TEMPLATES[template];
    groups[template].summary = {
      count: items.length,
      template_name: templateInfo?.name || `${template} template`,
      template_desc: templateInfo?.description || '',
      same_pricing_template: true,
    };
  }
  
  return groups;
}

/**
 * Calculate availability rate over N days
 */
export function calculateAvailabilityRate(historical_data, window_days = 30) {
  if (!historical_data || !Array.isArray(historical_data) || historical_data.length === 0) {
    return { rate: 0, status: 'insufficient_data', uptime_hours: 0 };
  }
  
  // Sort by timestamp
  const sorted = [...historical_data].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  
  // Count uptime vs total time
  let uptime_count = 0;
  let total_samples = 0;
  
  for (const entry of sorted) {
    const date = new Date(entry.timestamp);
    const cutoff = now();
    cutoff.setDate(cutoff.getDate() - window_days);
    
    if (date >= cutoff) {
      total_samples++;
      if (entry.status === 'success' || entry.status_code >= 200 && entry.status_code < 300) {
        uptime_count++;
      }
    }
  }
  
  const rateNum = total_samples > 0 ? (uptime_count / total_samples) * 100 : 0;
  const rate = rateNum.toFixed(1);
  const hours_ago =
    total_samples > 0
      ? Math.floor(
          (new Date(sorted[sorted.length - 1].timestamp).getTime() -
            new Date(sorted[0].timestamp).getTime()) /
            (1000 * 60 * 60),
        )
      : 0;
  
  return {
    rate: parseFloat(rate),
    status: rateNum >= 99 ? 'excellent' : rateNum >= 95 ? 'good' : rateNum >= 90 ? 'degraded' : 'critical',
    uptime_percentage: `${rate}%`,
    total_samples,
    window_days,
    hours_covered: Math.round(hours_ago * 100) / 100,
  };
}

/**
 * Track relay lifecycle events
 */
export function trackRelayLifecycle(relay_id, event_type, details = {}) {
  return {
    relay_id,
    event_type,  // added, removed, updated, discovered_via
    timestamp: nowISO(),
    source: details.source || 'manual',
    reason: details.reason || null,
    discoverer: details.discoverer || 'system',
  };
}

/**
 * Get relay history timeline
 */
export function getRelayHistoryTimeline(lifecycle_events) {
  if (!lifecycle_events || !Array.isArray(lifecycle_events)) return [];
  
  const sorted = [...lifecycle_events].sort((a, b) => 
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  
  return sorted.map(event => ({
    id: `${event.relay_id}_${event.event_type}_${new Date(event.timestamp).getTime()}`,
    type: formatEventType(event.event_type),
    timestamp: event.timestamp,
    source: event.source || 'unknown',
    message: generateEventMessage(event),
  }));
}

function formatEventType(type) {
  const formats = {
    added: '🆕 Added',
    removed: '❌ Removed',
    updated: '✏️ Updated',
    discovered_via: '🔍 Discovered Via',
  };
  return formats[type] || `📋 ${type}`;
}

function generateEventMessage(event) {
  switch (event.event_type) {
    case 'added':
      return `Added to monitoring list via ${event.source || 'manual'}`;
    case 'removed':
      return `Removed - Reason: ${event.reason || 'No reason provided'}`;
    case 'updated':
      return `Status/pricing updated`;
    case 'discovered_via':
      return `Discovered via ${event.source || 'unknown source'}`;
    default:
      return 'Event recorded';
  }
}

/**
 * Generate relay availability report
 */
export function generateRelayReport(relays, historicalDataMap) {
  const report = {
    total_relays: relays.length,
    by_availability_status: {},
    by_price_template: {},
    summary: {},
  };
  
  // Categorize by availability status
  const availabilityGroups = {};
  for (const relay of relays) {
    const data = historicalDataMap[relay.id] || [];
    const availability = calculateAvailabilityRate(data);
    
    const status = availability.status;
    if (!availabilityGroups[status]) {
      availabilityGroups[status] = [];
    }
    availabilityGroups[status].push({
      ...relay,
      availability_rate: availability.rate,
      availability_status: availability.status,
    });
    
    report.by_availability_status[status] = availabilityGroups[status].length;
  }
  
  // Group by price template
  const templateGroups = groupByPriceTemplate(relays);
  report.by_price_template = templateGroups;
  
  // Summary statistics
  const excellent = report.by_availability_status.excellent || 0;
  const good = report.by_availability_status.good || 0;
  const degraded = report.by_availability_status.degraded || 0;
  const critical = report.by_availability_status.critical || 0;
  
  report.summary = {
    excellent_count: excellent,
    good_count: good,
    degraded_count: degraded,
    critical_count: critical,
    overall_health: excellent > 0 && critical === 0 ? 'healthy' : 'needs_attention',
  };
  
  return report;
}

// URL query parameter parsing
export function parseRelayParams(params) {
  const showHistory = params.get('history') === 'true';
  const minAvailability = parseInt(params.get('min_availability'), 10) || 0;
  const sortBy = params.get('sort') || 'availability';
  
  return {
    filter_history: showHistory,
    min_availability_rate: minAvailability,
    sort_by: sortBy,
  };
}

// Export for CLI usage
export function generateICSRelayFeed(relays) {
  const now = nowISO();
  
  let ics = `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//IndexAI//Relay Status Monitor//EN\nCALSCALE:GREGORIAN\nMETHOD:PUBLISH\n`;
  
  for (const relay of relays) {
    ics += `BEGIN:VEVENT\n`;
    ics += `UID:${relay.id}@${HOST}\n`;
    ics += `DTSTAMP:${now}\n`;
    ics += `SUMMARY:Relay: ${relay.name}\n`;
    ics += `DESCRIPTION:URL: ${relay.url}\\nStatus: ${relay.status}\\nAvailability: ${relay.availability_rate}%`;
    ics += `END:VEVENT\n`;
  }
  
  ics += `END:VCALENDAR`;
  return ics;
}

export default {
  classifyPriceTemplate,
  groupByPriceTemplate,
  calculateAvailabilityRate,
  trackRelayLifecycle,
  getRelayHistoryTimeline,
  generateRelayReport,
  parseRelayParams,
  generateICSRelayFeed,
  PRICE_TEMPLATES,
};
