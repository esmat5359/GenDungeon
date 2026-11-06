import { MARK_PATH } from "../assets/genlayerMark";

interface Props {
  size?: number;
  className?: string;
  /** Adds the slow ember glow behind the arch. */
  glow?: boolean;
}

/**
 * The GenDungeon emblem: the GenLayer mark standing in a dungeon archway.
 * The doorway is the dungeon, the mark is the validator network that judges it.
 */
export default function Emblem({ size = 40, className, glow = false }: Props) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="emblem-stone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#27353b" />
          <stop offset="1" stopColor="#0d1316" />
        </linearGradient>
        <radialGradient id="emblem-glow" cx="50%" cy="62%" r="50%">
          <stop offset="0" stopColor="#f08a3c" stopOpacity="0.55" />
          <stop offset="1" stopColor="#f08a3c" stopOpacity="0" />
        </radialGradient>
      </defs>
      {glow && <circle cx="32" cy="38" r="30" fill="url(#emblem-glow)" />}
      <path d="M8 58V29a24 24 0 0 1 48 0v29z" fill="url(#emblem-stone)" />
      <path
        d="M8 58V29a24 24 0 0 1 48 0v29"
        fill="none"
        stroke="#f08a3c"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M14 58V30a18 18 0 0 1 36 0v28" fill="none" stroke="#3a4b52" strokeWidth="1" />
      <g transform="translate(17 20) scale(0.3)">
        <path d={MARK_PATH} fill="#5fc7b0" fillRule="evenodd" />
      </g>
      <path d="M6 58h52" stroke="#f08a3c" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
