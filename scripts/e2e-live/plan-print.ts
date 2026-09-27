import type { Block, Cell } from './plan.ts';

export function printPlan(cells: readonly Cell[], repeats: number): void {
  const byBlock = new Map<Block, Cell[]>();
  for (const cell of cells) byBlock.set(cell.block, [...(byBlock.get(cell.block) ?? []), cell]);
  let total = 0;
  for (const [block, list] of byBlock) {
    const sum = list.reduce((acc, cell) => acc + cell.expectUsd, 0);
    total += sum;
    console.log(`\n## ${block}: ${list.length} cells, $${sum.toFixed(2)} per repeat`);
    for (const cell of list) {
      const title = `${cell.scenario.id} ${cell.scenario.title}`.slice(0, 44).padEnd(44);
      console.log(
        `  ${title} ${cell.arm.padEnd(13)} ${cell.variant.padEnd(20)} $${cell.expectUsd.toFixed(3)}`,
      );
    }
  }
  console.log(
    `\nTotal: ${cells.length} cells, $${total.toFixed(2)} per repeat, $${(total * repeats).toFixed(2)} for ${repeats}.`,
  );
}
