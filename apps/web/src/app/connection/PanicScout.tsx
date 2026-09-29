import './panic-scout.css';
import { BlobScout } from '../../brand/BlobScout.tsx';

export function PanicScout({ fixing }: { fixing: boolean }) {
  return (
    <span className={fixing ? 'pscout fixing' : 'pscout'} aria-hidden="true">
      <span className="ps-shake">
        <BlobScout size={30} mood="sad" />
        <svg className="ps-face" viewBox="0 0 64 64">
          <ellipse className="ps-mouth" cx="32" cy="51" rx="4.2" ry="5" />
        </svg>
      </span>
      <i className="ps-sweat" />
      <i className="ps-sweat two" />
      <b className="ps-bang">!!</b>
      <svg className="ps-wrench" viewBox="0 0 24 24">
        <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.4 2.4-2.4-.6-.6-2.4z" />
      </svg>
      <span className="ps-sparks">
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}
