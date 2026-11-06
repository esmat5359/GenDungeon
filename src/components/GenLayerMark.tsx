import { MARK_PATH } from "../assets/genlayerMark";

interface Props {
  size?: number | string;
  className?: string;
  title?: string;
}

/** The official GenLayer mark, traced to vector (see scripts/logo/trace_mark.py). */
export default function GenLayerMark({ size = 24, className, title }: Props) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <path d={MARK_PATH} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}
