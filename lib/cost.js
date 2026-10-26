/**
 * Cost Calculation Library (T6.3)
 * 
 * Pure functions for comparing subscription costs vs pay-as-you-go pricing
 */

// Pricing models by vendor type
export const PRICING_MODELS = {
  official: { multiplier: 1.0, name: '官方渠道' },
  aggregator: { multiplier: 1.15, name: '聚合平台' },  // +15% markup
  relay: { multiplier: 1.35, name: '中转站' },  // +35% markup
};

// Subscription plans with monthly limits
export const SUBSCRIPTION_PLANS = {
  chatgpt_plus: {
    id: 'chatgpt_plus',
    name: 'ChatGPT Plus',
    price_monthly: 20,
    price_yearly: 200,
    free_tier: 1000,
    included_models: ['gpt-4o-mini', 'gpt-4'],
  },
  claude_pro: {
    id: 'claude_pro',
    name: 'Claude Pro',
    price_monthly: 20,
    price_yearly: 200,
    free_tier: 2000,
    included_models: ['claude-sonnet', 'claude-opus'],
  },
  gemini_advanced: {
    id: 'gemini_advanced',
    name: 'Gemini Advanced',
    price_monthly: 20,
    price_yearly: 200,
    free_tier: 5000,
    included_models: ['gemini-pro', 'gemini-ultra'],
  },
};

/**
 * Calculate pay-as-you-go cost for a given usage
 * @param {object} usage - Usage metrics
 * @param {number} usage.input_tokens - Input tokens used
 * @param {number} usage.output_tokens - Output tokens used
 * @param {string} usage.model - Model ID
 * @param {string} [usage.channel='official'] - Pricing channel (official/aggregator/relay)
 * @returns {number} Total cost in USD
 */
export function calculatePayAsYouGoCost({ input_tokens, output_tokens, model, channel = 'official' }) {
  // Normalize model to base family for pricing lookup
  const base_model = getModelFamily(model);
  
  // Get pricing rates (per million tokens)
  const rates = getRatesForModel(base_model, channel);
  
  const input_cost = (input_tokens / 1e6) * rates.input;
  const output_cost = (output_tokens / 1e6) * rates.output;
  
  return input_cost + output_cost;
}

/**
 * Calculate subscription cost based on usage and whether free tier covers it
 * @param {string} plan_id - Subscription plan ID
 * @param {object} usage - Actual usage
 * @param {number} usage.input_tokens
 * @param {number} usage.output_tokens
 * @returns {number} Effective cost (subscription if within limit, else subscription + overage)
 */
export function calculateSubscriptionCost(plan_id, { input_tokens, output_tokens }) {
  const plan = SUBSCRIPTION_PLANS[plan_id];
  if (!plan) return 0;
  
  // Check if usage is within free tier
  const total_tokens = input_tokens + output_tokens;
  
  if (total_tokens <= plan.free_tier) {
    return 0;  // Fully covered by free tier
  }
  
  // Calculate overage cost (assume $0.01 per 1K tokens beyond free tier)
  const overage_tokens = total_tokens - plan.free_tier;
  const overage_cost = (overage_tokens / 1000) * 0.01;
  
  // Return subscription price + overage
  return plan.price_monthly + overage_cost;
}

/**
 * Compare all available plans and find best value
 * @param {object} usage - Usage metrics
 * @returns {object} Comparison results with best option
 */
export function compareAllPlans(usage) {
  // Calculate pay-as-you-go for each channel
  const pay_as_you_go = Object.keys(PRICING_MODELS).map(channel => ({
    name: PRICING_MODELS[channel].name,
    cost: calculatePayAsYouGoCost({ ...usage, channel }),
    is_subscription: false,
  }));
  
  // Calculate subscription costs
  const subscriptions = Object.values(SUBSCRIPTION_PLANS).map(plan => ({
    name: plan.name,
    cost: calculateSubscriptionCost(plan.id, usage),
    is_subscription: true,
    details: {
      monthly_price: plan.price_monthly,
      yearly_price: plan.price_yearly,
      free_tier: plan.free_tier,
      included_models: plan.included_models,
    },
  }));
  
  const all_options = [...pay_as_you_go, ...subscriptions];
  const best_option = all_options.reduce((best, current) => 
    current.cost < best.cost ? current : best
  );
  
  // Calculate break-even point (where subscription becomes cheaper than pay-as-you-go)
  const bestFreeTier =
    /** @type {{details?: {free_tier?: number}}} */ (best_option).details?.free_tier || 0;
  const pei_points = calculatePEIPoints(bestFreeTier);
  
  return {
    usage,
    options: all_options.sort((a, b) => a.cost - b.cost),
    best_option,
    savings_vs_pay_as_you_go: Math.max(0, pay_as_you_go[0].cost - best_option.cost),
    pei_points,
  };
}

/**
 * Calculate points where subscription pays off vs pay-as-you-go
 * @param {number} free_tier - Free tier tokens
 * @returns {object} Break-even analysis
 */
export function calculatePEIPoints(free_tier) {
  const monthly_price = 20;  // Average subscription price
  
  // Pay-as-you-go rate approximation ($1/1M tokens average)
  const daily_cost_without_sub = monthly_price;
  const monthly_tokens_to_break_even = daily_cost_without_sub * 1e6;
  
  return {
    description: 'Where subscription saves money',
    without_free_tier: {
      description: 'If no free tier existed',
      break_even_monthly_tokens: monthly_tokens_to_break_even,
      break_even_daily_tokens: Math.ceil(monthly_tokens_to_break_even / 30),
    },
    with_free_tier: buildWithFreeTier(free_tier, monthly_tokens_to_break_even),
  };
}

/**
 * 计算「含免费额度」的盈亏平衡点。
 * 单独成函数是为了避免在对象字面量里引用自身尚未定义的键。
 * @param {number} free_tier 每月免费额度（token）
 * @param {number} monthly_break_even 不含免费额度时的月盈亏平衡 token 数
 */
function buildWithFreeTier(free_tier, monthly_break_even) {
  const after = monthly_break_even - free_tier;
  return {
    description: 'Actual break-even including free tier',
    effective_free_tier: free_tier,
    break_even_after_free_tier: after,
    advice:
      free_tier >= monthly_break_even
        ? 'Free tier covers your needs! Skip subscription.'
        : 'If you use more than ' +
          formatNumber(Math.max(0, after)) +
          ' additional tokens/month, get subscription.',
  };
}

/**
 * Get pricing rates for a specific model and channel
 * @param {string} model_family - Base model family
 * @param {string} channel - Pricing channel
 * @returns {object} Rates object
 */
function getRatesForModel(model_family, channel) {
  const multipliers = PRICING_MODELS[channel].multiplier;
  
  // Simplified pricing rates (per million tokens)
  const base_rates = {
    'gpt-4': { input: 30, output: 60 },
    'gpt-4o': { input: 5, output: 15 },
    'claude': { input: 8, output: 24 },
    'gemini': { input: 0.5, output: 1.5 },
    'default': { input: 0.2, output: 0.6 },
  };
  
  const base = base_rates[model_family] || base_rates.default;
  return {
    input: base.input * multipliers,
    output: base.output * multipliers,
  };
}

/**
 * Extract base model family from full model ID
 * @param {string} model_id - Full model identifier
 * @returns {string} Base model family
 */
function getModelFamily(model_id) {
  if (!model_id) return 'default';
  
  if (model_id.includes('gpt-4') || model_id.includes('gpt-5')) return 'gpt-4';
  if (model_id.includes('claude')) return 'claude';
  if (model_id.includes('gemini')) return 'gemini';
  
  return 'default';
}

/**
 * Format number with K/M/B suffixes
 * @param {number} num - Number to format
 * @returns {string} Formatted string
 */
export function formatNumber(num) {
  if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return Math.round(num).toString();
}

// Helper for URL query parsing
export function parseUsageFromURL(params) {
  const input = params.get('input') ? parseInt(params.get('input'), 10) : null;
  const output = params.get('output') ? parseInt(params.get('output'), 10) : null;
  const preset = params.get('preset');
  
  // Preset usage profiles
  const presets = {
    casual: { input: 10000, output: 5000 },
    developer: { input: 500000, output: 200000 },
    heavy: { input: 2000000, output: 1000000 },
  };
  
  if (preset && presets[preset]) {
    const { input, output } = presets[preset];
    return { input_tokens: input, output_tokens: output };
  }
  
  if (input !== null && output !== null) {
    return { input_tokens: input, output_tokens: output };
  }
  
  return null;  // Invalid usage data
}

export default {
  calculatePayAsYouGoCost,
  calculateSubscriptionCost,
  compareAllPlans,
  calculatePEIPoints,
  parseUsageFromURL,
  formatNumber,
  PRICING_MODELS,
  SUBSCRIPTION_PLANS,
};
