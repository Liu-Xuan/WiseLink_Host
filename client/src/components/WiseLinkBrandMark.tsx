import { Image } from '@client/src/components/ui/image';

interface WiseLinkBrandMarkProps {
  size: number;
}

/** User-supplied wiselink-app-icon.svg, preserved without redrawing. */
export default function WiseLinkBrandMark({ size }: WiseLinkBrandMarkProps) {
  return (
    <Image
      src={`${import.meta.env.BASE_URL}wiselink-mark.svg`}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      loading="eager"
      className="wiselink-brand-image"
    />
  );
}
