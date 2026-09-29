import { SCOUT_ANTENNA, SCOUT_BODY, SCOUT_SPARK } from '../brand/scout-shape.ts';
import { BUBBLES, type BlobMood } from './reset-blob-mood.ts';
import './reset-blob.css';

interface ResetBlobProps {
  mood: BlobMood;
  size: number;
  className: string;
}

function Face() {
  return (
    <>
      <g className="rb-look">
        <g className="rb-part rb-dots">
          <rect x="22.5" y="32" width="5.6" height="11" rx="2.8" />
          <rect x="35.9" y="32" width="5.6" height="11" rx="2.8" />
        </g>
        <g className="rb-part rb-wide">
          <circle cx="25.3" cy="37.5" r="4.6" />
          <circle cx="38.7" cy="37.5" r="4.6" />
          <circle className="rb-shine" cx="26.8" cy="35.8" r="1.5" />
          <circle className="rb-shine" cx="40.2" cy="35.8" r="1.5" />
        </g>
        <g className="rb-part rb-plead">
          <circle cx="25" cy="38" r="5.4" />
          <circle cx="39" cy="38" r="5.4" />
          <circle className="rb-shine" cx="26.9" cy="35.9" r="1.9" />
          <circle className="rb-shine" cx="40.9" cy="35.9" r="1.9" />
          <circle className="rb-shine" cx="23.5" cy="40.4" r="0.9" />
          <circle className="rb-shine" cx="37.5" cy="40.4" r="0.9" />
        </g>
        <path
          className="rb-part rb-line rb-squeeze"
          d="M21.5 31.5L27.5 35.5L21.5 39.5M42.5 31.5L36.5 35.5L42.5 39.5"
        />
        <path
          className="rb-part rb-line rb-happy"
          d="M22.4 40.5Q25.3 34.5 28.2 40.5M35.8 40.5Q38.7 34.5 41.6 40.5"
        />
        <path
          className="rb-part rb-line rb-closed"
          d="M22.4 37.5Q25.3 41.5 28.2 37.5M35.8 37.5Q38.7 41.5 41.6 37.5"
        />
        <path className="rb-part rb-line rb-brows" d="M20.5 30.5L27 28M37 28L43.5 30.5" />
      </g>
      <g className="rb-part rb-cheeks">
        <circle cx="17.5" cy="46" r="2.7" />
        <circle cx="46.5" cy="46" r="2.7" />
      </g>
      <path className="rb-part rb-line rb-wobble" d="M27.5 50.5Q29.8 48.5 32 50.5T36.5 50.5" />
      <ellipse className="rb-part rb-fill rb-o" cx="32" cy="50" rx="2.4" ry="3" />
      <g className="rb-part rb-scream">
        <ellipse className="rb-fill" cx="32" cy="48.5" rx="5.6" ry="7" />
        <ellipse className="rb-tongue" cx="32" cy="53" rx="3.4" ry="2.2" />
      </g>
      <path className="rb-part rb-fill rb-smile" d="M26.5 46.5Q32 55.5 37.5 46.5Z" />
    </>
  );
}

export function ResetBlob({ mood, size, className }: ResetBlobProps) {
  const bubble = BUBBLES[mood];
  return (
    <span className={`rb ${className}`} data-mood={mood} aria-hidden="true">
      <span className="rb-roam">
        <span className="rb-hop">
          <svg className="rb-svg" viewBox="0 0 64 64" width={size} height={size}>
            <rect className="rb-part rb-arm" x="49" y="29" width="7" height="14" rx="3.5" />
            <path className="rb-ant" d={SCOUT_ANTENNA} />
            <path className="rb-spark" d={SCOUT_SPARK} />
            <path className="rb-skin" d={SCOUT_BODY} />
            <Face />
            <path
              className="rb-part rb-sweat"
              d="M12 20C12 20 8.2 25.6 8.2 28A3.8 3.8 0 0 0 15.8 28C15.8 25.6 12 20 12 20Z"
            />
            <g className="rb-part rb-puff">
              <circle cx="14" cy="53" r="3.2" />
              <circle cx="8.5" cy="50" r="2.5" />
              <circle cx="4" cy="54" r="1.8" />
            </g>
          </svg>
        </span>
        {bubble && (
          <span key={mood} className="rb-bubble">
            {bubble}
          </span>
        )}
      </span>
    </span>
  );
}
