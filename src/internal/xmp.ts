import type { XmpMetadataOptions } from '../types.js';

export function buildXmpMetadataPacket(options: XmpMetadataOptions): string {
  const title =
    options.title === undefined
      ? ''
      : `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(options.title)}</rdf:li></rdf:Alt></dc:title>`;
  const creators = normalizeCreators(options);
  const creator =
    creators.length === 0
      ? ''
      : `<dc:creator><rdf:Seq>${creators.map((value) => `<rdf:li>${escapeXml(value)}</rdf:li>`).join('')}</rdf:Seq></dc:creator>`;
  const producer = `<pdf:Producer>${escapeXml(options.producer ?? 'sempdf')}</pdf:Producer>`;
  const creatorTool =
    options.creatorTool === undefined
      ? ''
      : `<xmp:CreatorTool>${escapeXml(options.creatorTool)}</xmp:CreatorTool>`;
  const createDate = xmpDate(options.createDate);
  const modifyDate = xmpDate(options.modifyDate);
  const metadataDate = xmpDate(options.metadataDate);

  return [
    '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">',
    '<dc:format>application/pdf</dc:format>',
    title,
    creator,
    producer,
    creatorTool,
    createDate === undefined
      ? ''
      : `<xmp:CreateDate>${escapeXml(createDate)}</xmp:CreateDate>`,
    modifyDate === undefined
      ? ''
      : `<xmp:ModifyDate>${escapeXml(modifyDate)}</xmp:ModifyDate>`,
    metadataDate === undefined
      ? ''
      : `<xmp:MetadataDate>${escapeXml(metadataDate)}</xmp:MetadataDate>`,
    '</rdf:Description>',
    '</rdf:RDF>',
    '</x:xmpmeta>',
    '<?xpacket end="w"?>',
  ].join('');
}

function normalizeCreators(options: XmpMetadataOptions): string[] {
  if (options.creators !== undefined) {
    return [...options.creators];
  }
  return options.creator === undefined ? [] : [options.creator];
}

function xmpDate(value: Date | string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'string') {
    return value;
  }
  return value.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
