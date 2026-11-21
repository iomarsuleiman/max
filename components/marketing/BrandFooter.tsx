/** A quiet publisher's signature, sized like the Arc footer reference. */
export function BrandFooter() {
  return (
    <div className="flex min-h-[22rem] items-center justify-center px-6 py-20 text-center sm:min-h-[24rem]">
      <a href="https://wareed.io" className="rounded-sm px-3 py-2 text-fg-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-4" style={{ fontFamily: '"Times New Roman", Times, serif', fontSize: 18, lineHeight: 1.15 }}>
        <span className="italic">By</span>{" "}
        <span className="uppercase tracking-[.015em]">Wareed</span>
      </a>
    </div>
  );
}
