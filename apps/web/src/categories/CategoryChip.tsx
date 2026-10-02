import './categories.css';
import { categoryLabel, type Category } from '@spark-outpost/contracts';

export function CategoryChip({ category }: { category: Category | null | undefined }) {
  if (!category) return null;
  return (
    <span className="cat-chip" title="What Spark read this request as">
      {categoryLabel(category)}
    </span>
  );
}
