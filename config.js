import { numberSetting, validateTiers } from './core.js?v=1.5.0';

export function validateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config) || ![1, 2].includes(config.v)) throw new Error('Unsupported config version. Expected v1 or v2.');
  const custom = config.tier_mode === 'custom';
  const standard = config.standard_tiers;
  if (!custom && (!Array.isArray(standard?.thresholds) || standard.thresholds.length !== 3 || !Array.isArray(standard.points) || standard.points.length !== 3)) throw new Error('Standard config needs three thresholds and three point values.');
  const tiers = validateTiers(custom ? config.custom_tiers || [] : ['orange', 'purple', 'blue'].map((name, i) => ({ name, color: ['#ff8c00', '#b77cce', '#3498db'][i], threshold: standard.thresholds[i], points: standard.points[i] })));
  const weights = new Map();
  if (config.trait_weights != null && (typeof config.trait_weights !== 'object' || Array.isArray(config.trait_weights))) throw new Error('Trait weights must be a name-to-number object.');
  for (const [type, value] of Object.entries(config.trait_weights || {})) weights.set(type, numberSetting(value, 1, 0, 10));
  return { ...config, mode: config.mode === 'all' ? 'all' : 'listed', tier_mode: custom ? 'custom' : 'standard', tiers, weights,
    score_missing: config.score_missing === true, score_pairs: config.score_pairs === true,
    missing_bonus: numberSetting(config.missing_bonus, 1.5, 0, 10), combo_bonus: numberSetting(config.combo_bonus, 2, 0, 10) };
}
