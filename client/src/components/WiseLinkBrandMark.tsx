import { Image } from '@client/src/components/ui/image';

interface WiseLinkBrandMarkProps {
  size: number;
}

/** Faithful web export of the user-supplied WiseLink飞信.psd. */
export default function WiseLinkBrandMark({ size }: WiseLinkBrandMarkProps) {
  return (
    <Image
      src={`${import.meta.env.BASE_URL}wiselink-brand.png`}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      loading="eager"
      className="wiselink-brand-image"
    />
  );
}
