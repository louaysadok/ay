/**
 * createMachine.js — type → class registry.
 * Adding a new terminal machine means: a spec in data/machines.json, a class in
 * src/sim/, and one line here.
 */
import { Forklift } from '../sim/Forklift.js';
import { ReachStacker } from '../sim/ReachStacker.js';
import { RTG } from '../sim/RTG.js';
import { HarborCrane } from '../sim/HarborCrane.js';
import { Tractor } from '../sim/Tractor.js';

export const MACHINE_CLASSES = {
  forklift: Forklift,
  reachstacker: ReachStacker,
  rtg: RTG,
  harborcrane: HarborCrane,
  tractor: Tractor
};

/** Build a machine from a spec + options. Unknown types fall back to the forklift. */
export function createMachine(spec, opts = {}) {
  const Cls = MACHINE_CLASSES[spec?.id] || MACHINE_CLASSES[spec?.type] || Forklift;
  return new Cls(spec, opts);
}

export default createMachine;
