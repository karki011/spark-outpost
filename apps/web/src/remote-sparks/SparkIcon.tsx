import './spark-icon.css';
import { LaptopIcon } from '../ui/icons.tsx';

export function SparkIcon({ icon, size }: { icon: string | null; size: number }) {
  return (
    <i className="rs-icon" style={{ width: size, height: size }} aria-hidden="true">
      {icon === null ? (
        <LaptopIcon />
      ) : (
        <img src={icon} alt="" width={size} height={size} loading="lazy" decoding="async" />
      )}
    </i>
  );
}
