/**
 * ScoringSystem.js — safety-first scoring for finished missions/lessons.
 *
 *   Safety 35% · Accuracy 25% · Equipment use 20% · Time 10% · Efficiency 10%
 *
 * Safety is weighted highest on purpose: the game teaches that a slow, clean
 * operation beats a fast, damaging one. Each category returns 0..100 plus a
 * short explanatory note that the Mentor reads back in the debrief.
 */
import { clamp } from '../engine/Utils.js';

export const WEIGHTS = { safety: 0.35, accuracy: 0.25, equipment: 0.20, time: 0.10, efficiency: 0.10 };

export const MEDALS = [
  { id: 'gold', min: 85 }, { id: 'silver', min: 70 }, { id: 'bronze', min: 55 }
];

export class ScoringSystem {
  constructor({ terminal, settings, i18n }) {
    this.terminal = terminal;
    this.settings = settings;
    this.i18n = i18n;
  }

  /** Compute the full result record for a finished mission. */
  compute(mission, ctx = {}) {
    const assist = this.settings?.assistFactor?.() ?? 1;
    const safety = this.scoreSafety(mission, ctx);
    const accuracy = this.scoreAccuracy(mission, ctx);
    const equipment = this.scoreEquipment(mission, ctx);
    const time = this.scoreTime(mission, ctx);
    const efficiency = this.scoreEfficiency(mission, ctx);
    const total = Math.round(
      safety.value * WEIGHTS.safety +
      accuracy.value * WEIGHTS.accuracy +
      equipment.value * WEIGHTS.equipment +
      time.value * WEIGHTS.time +
      efficiency.value * WEIGHTS.efficiency
    );
    const medal = this.medalFor(total);
    const categories = { safety, accuracy, equipment, time, efficiency };
    // weakest category drives the Mentor's debrief line
    let weakest = 'none';
    if (total < 92) {
      weakest = Object.entries(categories)
        .filter(([k]) => k !== 'safety' || safety.value < 80)
        .sort((a, b) => a[1].value - b[1].value)[0][0];
    }
    return {
      score: total,
      medal: medal.id,
      categories,
      breakdown: Object.fromEntries(Object.entries(categories).map(([k, v]) => [k, Math.round(v.value)])),
      perfect: mission.safetyEvents === 0 && mission.impacts.length === 0,
      weakest,
      grade: total >= 85 ? 'excellent' : total >= 70 ? 'good' : total >= 55 ? 'ok' : 'poor',
      safetyEvents: mission.safetyEvents,
      impacts: mission.impacts.length,
      assist
    };
  }

  /* ------------------------------------------------------------- safety -- */
  scoreSafety(mission, ctx) {
    const assist = this.settings?.assistFactor?.() ?? 1;
    const hard = mission.impacts.filter((i) => i.severity > 1.1).length;
    const soft = mission.impacts.length - hard;
    const ped = ctx.pedestrianEvents ?? 0;
    const zone = ctx.zoneEvents ?? 0;
    const unstable = ctx.unstableEvents ?? 0;
    let v = 100
      - mission.safetyEvents * 7
      - hard * 16
      - soft * 6
      - ped * 9
      - zone * 4
      - unstable * 5;
    v = clamp(v / assist, 0, 100);
    const notes = [];
    if (hard) notes.push(`${hard} hard impact${hard > 1 ? 's' : ''}`);
    if (soft) notes.push(`${soft} light contact${soft > 1 ? 's' : ''}`);
    if (ped) notes.push(`${ped} pedestrian near-miss${ped > 1 ? 'es' : ''}`);
    if (zone) notes.push(`${zone} restricted-zone entry${zone > 1 ? ' entries' : ''}`);
    if (!notes.length) notes.push('no safety events');
    return { value: v, note: notes.join(', ') };
  }

  /* ----------------------------------------------------------- accuracy -- */
  scoreAccuracy(mission, ctx) {
    const placed = mission.placedIds.size;
    const offTarget = ctx.misplacedCount ?? 0;
    const rehandles = ctx.rehandleCount ?? 0;
    const damage = this.terminal.stats.damage - (mission._base?.damage ?? 0);
    let v = 100 - offTarget * 12 - rehandles * 5 - damage * 25;
    if (placed === 0 && mission.def.objectives?.some((o) => ['place', 'deliver', 'stack'].includes(o.type))) v -= 10;
    v = clamp(v, 0, 100);
    const parts = [];
    if (offTarget) parts.push(`${offTarget} load(s) placed outside the target`);
    if (rehandles) parts.push(`${rehandles} extra re-handle(s)`);
    if (damage) parts.push(`${damage} cargo damage event(s)`);
    if (!parts.length) parts.push('loads placed on target');
    return { value: v, note: parts.join(', ') };
  }

  /* ---------------------------------------------------------- equipment --- */
  scoreEquipment(mission, ctx) {
    const over = mission.overcapacityAttempts ?? 0;
    const wrong = mission.wrongAttachmentAttempts ?? 0;
    const requiredSize = ctx.spreaderMisuse ?? 0;
    const highForkTravel = ctx.highForkTravel ?? 0;    // seconds travelled with forks raised
    const loads = mission.liftedIds.size;
    let v = 100 - over * 12 - wrong * 8 - requiredSize * 10 - clamp(highForkTravel / 6, 0, 20);
    if (loads === 0 && (mission.def.objectives || mission.def.goals || []).some((o) => String(o.type).startsWith('lift'))) v -= 8;
    v = clamp(v, 0, 100);
    const parts = [];
    if (over) parts.push(`${over} attempt(s) over the rated capacity`);
    if (wrong) parts.push(`${wrong} attempt(s) with the wrong attachment`);
    if (highForkTravel > 6) parts.push(`${Math.round(highForkTravel)} s travelled with raised forks`);
    if (!parts.length) parts.push('machine used within its limits');
    return { value: v, note: parts.join(', ') };
  }

  /* --------------------------------------------------------------- time -- */
  scoreTime(mission, ctx) {
    if (!mission.timeLimit) {
      // no clock: reward a steady, uninterrupted run instead
      const idleRatio = mission.elapsed > 0 ? mission.idleTime / mission.elapsed : 0;
      const base = clamp(100 - (mission.elapsed / 60) * 0.8, 55, 100);
      return { value: clamp(base - idleRatio * 30, 0, 100), note: `${Math.round(idleRatio * 100)}% of the time stationary` };
    }
    const used = mission.elapsed / mission.timeLimit;
    const v = clamp(100 - Math.max(0, used - 0.45) * 105, 20, 100);
    return { value: v, note: `${Math.round(used * 100)}% of the time allowance used` };
  }

  /* --------------------------------------------------------- efficiency -- */
  scoreEfficiency(mission, ctx) {
    const loads = mission.liftedIds.size || 1;
    const distance = mission.distance;
    const expected = ctx.expectedDistance ?? (loads * 120 + 80);
    const ratio = distance / expected;
    const v = clamp(100 - Math.max(0, ratio - 1) * 42, 25, 100);
    const empty = ctx.emptyRuns ?? 0;
    return {
      value: clamp(v - empty * 6, 0, 100),
      note: `${distance.toFixed(0)} m travelled (${ratio.toFixed(2)}× the expected route)`
    };
  }

  medalFor(score) {
    for (const m of MEDALS) if (score >= m.min) return m;
    return { id: null, min: 0 };
  }

  /** Reward maths shared by career and academy. */
  rewards(mission, result) {
    const def = mission.def;
    const baseXp = def.xp ?? 100;
    const baseCredits = def.credits ?? 200;
    const mult = clamp(result.score / 80, 0.35, 1.5);
    const medalBonus = result.medal === 'gold' ? 1.25 : result.medal === 'silver' ? 1.12 : 1;
    return {
      xp: Math.round(baseXp * mult * medalBonus),
      credits: Math.round(baseCredits * mult * medalBonus),
      medalBonus
    };
  }

  /** Feedback lines for the debrief panel, in the player's language. */
  feedback(mission, result, i18n) {
    const t = (k, v) => (i18n ? i18n.t(k, v) : k);
    const lines = [];
    const intro = result.perfect ? t('mentor.debriefPerfect')
      : result.score >= 70 ? t('mentor.debriefGood', { weakness: t(`mentor.weakness.${result.weakest}`) })
        : t('mentor.debriefPoor', { weakness: t(`mentor.weakness.${result.weakest}`) });
    lines.push(intro);
    for (const [key, cat] of Object.entries(result.categories)) {
      lines.push(`${t(`score.${key === 'equipment' ? 'equipment' : key}`)} — ${cat.note}`);
    }
    return lines;
  }
}

export default ScoringSystem;
