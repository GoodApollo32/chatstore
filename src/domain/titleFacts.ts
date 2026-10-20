// Reads searchable key specs out of a distributor's product title. Distributors cram the key facts
// into short, abbreviated titles ("TB 15 G2 CI5-1135G7 8/256GB 15.6 W11P", "OPTIPLEX 7020 SFF I5-14500
// 16GB 512GB W11P"), often cut off at about 60 characters, and Ingram Canada sends no other specs.
// Anything not recognised is simply left out: a missing fact is better than a wrong one.

export interface ProductFacts {
  processorBrand?: 'Intel' | 'AMD' | 'Qualcomm' | 'MediaTek';
  /** e.g. "Core i5", "Core Ultra 7", "Core 5", "Ryzen 7", "Ryzen AI 7", "Xeon", "Celeron". */
  processorLine?: string;
  /** Comparable level across brands: 1 (entry: Celeron, Pentium, N-series, Athlon), 3, 5, 7, 9. */
  processorTier?: number;
  /** e.g. "i5-1335U", "Ultra 7 155H", "Ryzen 5 7530U". */
  processorModel?: string;
  memoryGb?: number;
  storageGb?: number;
  storageType?: 'SSD' | 'HDD' | 'eMMC';
  screenInches?: number;
  /** e.g. "HD", "FHD", "WUXGA", "QHD", "WQXGA", "2.8K", "4K UHD", "5K". */
  resolution?: string;
  /** e.g. "Windows 11 Pro", "Windows 11 Home", "ChromeOS", "No OS". */
  os?: string;
  /** e.g. "NVIDIA RTX A1000", "NVIDIA RTX 2000 Ada". */
  graphics?: string;
  dedicatedGraphics?: boolean;
  formFactor?: 'Tower' | 'Small form factor' | 'Mini' | 'All-in-one';
  refreshHz?: number;
  panel?: 'IPS' | 'VA' | 'OLED' | 'TN';
  usbC?: boolean;
  dockConnection?: 'Thunderbolt 5' | 'Thunderbolt 4' | 'Thunderbolt 3' | 'Thunderbolt' | 'USB4' | 'USB-C' | 'USB-A';
  powerW?: number;
}

const LAPTOP_SCREENS = new Set([10.1, 10.5, 11, 11.6, 12, 12.2, 12.3, 12.4, 12.5, 13, 13.3, 13.4, 13.5, 13.6, 14, 14.5, 15, 15.3, 15.6, 16, 17, 17.3, 18]);
const MONITOR_SIZES = new Set([19, 19.5, 20, 21, 21.5, 22, 23, 23.8, 24, 25, 27, 28, 29, 31.5, 32, 34, 38, 40, 42, 43, 45, 49, 55]);
const MEMORY_SIZES = new Set([2, 3, 4, 6, 8, 12, 16, 18, 20, 24, 32, 36, 40, 48, 64, 96, 128, 192, 256]);
const STORAGE_SIZES = new Set([16, 32, 64, 128, 240, 250, 256, 480, 500, 512, 960, 1000, 1024, 1536, 2000, 2048, 3072, 4000, 4096, 6144, 8192]);

export function factsFromTitle(rawTitle: string, category: string): ProductFacts {
  const t = normalize(rawTitle);
  const facts: ProductFacts = {};
  const computer = category === 'Laptops' || category === 'Desktops';

  if (computer) {
    Object.assign(facts, processor(t));
    const gpu = graphics(t);
    Object.assign(facts, gpu.facts);
    Object.assign(facts, memoryAndStorage(gpu.rest));
    const os = operatingSystem(t);
    if (os) facts.os = os;
  }
  if (category === 'Laptops') {
    const size = screenSize(t, LAPTOP_SCREENS, true);
    if (size) facts.screenInches = size;
  }
  if (category === 'Desktops') {
    const ff = formFactor(t);
    if (ff) facts.formFactor = ff;
    if (ff === 'All-in-one') {
      const size = screenSize(t, MONITOR_SIZES, false);
      if (size) facts.screenInches = size;
    }
  }
  if (category === 'Monitors') {
    const size = screenSize(t, MONITOR_SIZES, false) ?? monitorSizeFromModel(t);
    if (size) facts.screenInches = size;
    const hz = t.match(/\b(\d{2,3})\s?HZ\b/);
    if (hz) facts.refreshHz = Number(hz[1]);
    const panel = t.match(/\b(IPS|VA|OLED|TN)\b/);
    if (panel) facts.panel = panel[1] as ProductFacts['panel'];
    if (/USB[- ]?C\b|\bUSBC\b|TYPE[- ]?C\b|THUNDERBOLT|\bTB ?[345]\b/.test(t)) facts.usbC = true;
  }
  if (computer || category === 'Monitors') {
    const res = resolution(t);
    if (res) facts.resolution = res;
  }
  if (category === 'Docking Stations') {
    const conn = dockConnection(t);
    if (conn) facts.dockConnection = conn;
    const w = t.match(/\b(\d{2,3}) ?W\b/);
    if (w) facts.powerW = Number(w[1]);
  }
  return facts;
}

function normalize(title: string): string {
  return ` ${title.toUpperCase()} `
    .replace(/[”″]|''/g, '"')
    .replace(/(\d)\s*"/g, '$1IN ')
    .replace(/(\d)\s*-?\s*INCH(ES)?\b/g, '$1IN')
    .replace(/[,;|()]/g, ' ')
    .replace(/\s+/g, ' ');
}

function processor(t: string): Partial<ProductFacts> {
  let m: RegExpMatchArray | null;
  const intel = (line: string, tier: number, model?: string): Partial<ProductFacts> =>
    ({ processorBrand: 'Intel', processorLine: line, processorTier: tier, ...(model ? { processorModel: model } : {}) });
  const amd = (line: string, tier: number, model?: string): Partial<ProductFacts> =>
    ({ processorBrand: 'AMD', processorLine: line, processorTier: tier, ...(model ? { processorModel: model } : {}) });

  // Intel Core Ultra: "CORE ULTRA 7 155H", "ULTRA 5 125U", "CU7-155H", "U7-165U", "U5 125U".
  if ((m = t.match(/\b(?:CORE ?)?ULTRA ?([579])(?:[- ]?(\d{3}[A-Z]{1,2}))?\b/) ?? t.match(/\bCU([579])(?:[- ]?(\d{3}[A-Z]{1,2}))?\b/) ?? t.match(/\bU([579])[- ](\d{3}[A-Z]{1,2})\b/))) {
    return intel(`Core Ultra ${m[1]}`, Number(m[1]), m[2] ? `Ultra ${m[1]} ${m[2]}` : undefined);
  }
  // Intel Core i3/i5/i7/i9: "I5-1335U", "CI5-1135G7", "CORE I7 13700", "I5".
  if ((m = t.match(/\b(?:CORE ?)?C?I([3579])(?:[- ]?(\d{4,5}[A-Z]{0,2}\d?))?\b/))) {
    return intel(`Core i${m[1]}`, Number(m[1]), m[2] ? `i${m[1]}-${m[2]}` : undefined);
  }
  // Intel Core 3/5/7 (Series 1/2, no "Ultra"): "CORE 5 120U", "C5-120U".
  if ((m = t.match(/\bCORE ?([3579]) ?(\d{3}[A-Z]{1,2})\b/) ?? t.match(/\bC([3579])-(\d{3}[A-Z]{1,2})\b/))) {
    return intel(`Core ${m[1]}`, Number(m[1]), `Core ${m[1]} ${m[2]}`);
  }
  if ((m = t.match(/\bXEON\b(?: ?(W[3579]?-?\d{4,5}[A-Z]*|E-?\d{4}[A-Z]*))?/) ?? t.match(/\b(W[3579]-\d{4}[A-Z]?)\b/))) {
    return intel('Xeon', 7, m[1] ? `Xeon ${m[1]}` : undefined);
  }
  if (/\bCELERON\b/.test(t)) return intel('Celeron', 1);
  if (/\bPENTIUM\b/.test(t)) return intel('Pentium', 1);
  if ((m = t.match(/\b(?:INTEL )?(N(?:50|97|100|150|200|250|300|305|350|355))\b/))) return intel('Intel N-series', 1, m[1]);

  // AMD: "RYZEN AI 7 PRO 360", "RYZEN 5 7530U", "R7 PRO 7840U", "R5-7530U", "R5".
  if ((m = t.match(/\bRYZEN ?AI ?(?:MAX\+? ?)?([3579])(?: ?PRO)?(?: ?(\d{3}[A-Z]{0,2}))?\b/))) {
    return amd(`Ryzen AI ${m[1]}`, Number(m[1]), m[2] ? `Ryzen AI ${m[1]} ${m[2]}` : undefined);
  }
  if ((m = t.match(/\bRYZEN ?([3579])(?: ?PRO)?(?:[- ]?(\d{4}[A-Z]{0,3}))?\b/) ?? t.match(/\bR([3579])(?:P| ?PRO)?[- ](\d{4}[A-Z]{0,3})\b/) ?? t.match(/\bR([3579])(?:P| PRO)?\b/))) {
    return amd(`Ryzen ${m[1]}`, Number(m[1]), m[2] ? `Ryzen ${m[1]} ${m[2]}` : undefined);
  }
  if (/\bATHLON\b/.test(t)) return amd('Athlon', 1);

  if ((m = t.match(/\bX ?ELITE\b|\bX1E\b|\bX1E-\d/))) return { processorBrand: 'Qualcomm', processorLine: 'Snapdragon X Elite', processorTier: 7 };
  if ((m = t.match(/\bX ?PLUS\b|\bX1P\b|\bX1P-\d/))) return { processorBrand: 'Qualcomm', processorLine: 'Snapdragon X Plus', processorTier: 5 };
  if (/\bSNAPDRAGON\b/.test(t)) return { processorBrand: 'Qualcomm', processorLine: 'Snapdragon', processorTier: 3 };
  if (/\bMEDIATEK\b|\bKOMPANIO\b|\bMT8\d{3}\b/.test(t)) return { processorBrand: 'MediaTek', processorLine: 'MediaTek', processorTier: 1 };
  return {};
}

/** Finds the graphics card and removes it (with its own memory, e.g. "RTX A2000 12GB") from the text. */
function graphics(t: string): { facts: Partial<ProductFacts>; rest: string } {
  const patterns: [RegExp, (m: RegExpMatchArray) => string, boolean][] = [
    [/\bRTX ?(A\d{3,4}|\d{3,4})(?: ?(ADA))?\b/, (m) => `NVIDIA RTX ${m[1]}${m[2] ? ' Ada' : ''}`, true],
    [/\bGTX ?(\d{3,4})\b/, (m) => `NVIDIA GTX ${m[1]}`, true],
    [/\bQUADRO ?([A-Z]?\d{3,4})?\b/, (m) => `NVIDIA Quadro${m[1] ? ` ${m[1]}` : ''}`, true],
    [/\b(?:NVIDIA )?MX ?(\d{3})\b/, (m) => `NVIDIA MX${m[1]}`, true],
    [/\b(?:NVIDIA )?T(400|550|600|1000|1200)\b/, (m) => `NVIDIA T${m[1]}`, true],
    [/\bRADEON ?PRO ?(W?\d{4}[A-Z]*)\b/, (m) => `AMD Radeon Pro ${m[1]}`, true],
    [/\b(?:RADEON )?RX ?(\d{4}[A-Z]*)\b/, (m) => `AMD Radeon RX ${m[1]}`, true],
    [/\bARC ?(?:PRO ?)?(A\d{2,3}M?)\b/, (m) => `Intel Arc ${m[1]}`, true],
    [/\bNVIDIA\b/, () => 'NVIDIA', true],
  ];
  for (const [re, name, dedicated] of patterns) {
    const m = t.match(re);
    if (!m) continue;
    // Drop the card and any memory size right after it, so "A2000 12GB" isn't read as system memory.
    const rest = t.replace(new RegExp(`${re.source}(?: ?\\d{1,2} ?GB?(?: ?GDDR\\d\\w*)?)?`), ' ').replace(/\b\d{1,2} ?GB? ?GDDR\d\w*/g, ' ');
    return { facts: { graphics: name(m), dedicatedGraphics: dedicated }, rest };
  }
  return { facts: {}, rest: t.replace(/\b\d{1,2} ?GB? ?GDDR\d\w*/g, ' ') };
}

function memoryAndStorage(t: string): Partial<ProductFacts> {
  const facts: Partial<ProductFacts> = {};
  const storageType = (s: string) =>
    /SSD|NVME|PCIE|M\.2|\bOPAL\b/.test(s) ? 'SSD' : /HDD|7200|5400\b/.test(s) ? 'HDD' : /EMMC|\bUFS\b/.test(s) ? 'eMMC' : undefined;
  const gb = (value: string, unit: string) => {
    const n = Number(value);
    // "12500T" is a processor model, not 12,500 TB.
    if (/^T/.test(unit)) return n <= 8 ? Math.round(n * 1024) : NaN;
    return n;
  };

  // "8/256GB", "16GB/512GB", "16G/512G", "16/1TB": memory / storage.
  const pair = t.match(/\b(\d{1,3}) ?(?:GB?)? ?\/ ?(\d(?:\.\d)?|\d{3,4}) ?(GB?|TB?)?(?=[\s,]|$)(.{0,12})/);
  if (pair) {
    const mem = Number(pair[1]);
    const unit = pair[3] ?? (Number(pair[2]) < 10 ? 'TB' : 'GB');
    const storage = gb(pair[2]!, unit);
    if (MEMORY_SIZES.has(mem) && storage >= 32) {
      facts.memoryGb = mem;
      facts.storageGb = storage;
      const type = storageType(pair[4] ?? '');
      if (type) facts.storageType = type;
      return facts;
    }
  }

  // Otherwise each size in turn: "16GB 512GB SSD", "32GB DDR5 1TB", "16G 512G".
  // The word right after a size says what it is ("512GB SSD", "32GB DDR5"); looked at without consuming it.
  const sizes = [...t.matchAll(/\b(\d{1,4}(?:\.\d)?) ?(GB|TB|G|T)\b(?= ?([A-Z0-9.]*))/g)]
    .map((m) => ({ value: gb(m[1]!, m[2]!), unit: m[2]!, after: m[3] ?? '' }))
    // "4G LTE" / "5G" are mobile networks, not memory; "2400G" is a processor model.
    .filter((s) => Number.isFinite(s.value) && !/^(LTE|WWAN|CELL|MODEM|NR\b)/.test(s.after) && !(s.unit === 'G' && s.value < 8))
    .filter((s) => MEMORY_SIZES.has(s.value) || STORAGE_SIZES.has(s.value));
  for (const [i, s] of sizes.entries()) {
    const memoryWord = /^(L?P?DDR|RAM|MEMORY|SODIMM)/.test(s.after);
    const type = storageType(s.after);
    if (memoryWord && facts.memoryGb === undefined) facts.memoryGb = s.value;
    else if (type && facts.storageGb === undefined) {
      facts.storageGb = s.value;
      facts.storageType = type;
    } else if (facts.memoryGb === undefined && MEMORY_SIZES.has(s.value) && (s.value <= 64 || sizes.slice(i + 1).some((x) => x.value > s.value))) {
      facts.memoryGb = s.value;
    } else if (facts.storageGb === undefined && s.value >= 64 && STORAGE_SIZES.has(s.value)) {
      facts.storageGb = s.value;
      const t2 = storageType(s.after);
      if (t2) facts.storageType = t2;
    }
  }
  return facts;
}

function screenSize(t: string, allowed: Set<number>, allowBare: boolean): number | undefined {
  for (const m of t.matchAll(/\b(\d{2}(?:\.\d)?) ?IN\b/g)) {
    const n = Number(m[1]);
    if (allowed.has(n)) return n;
  }
  if (!allowBare) return undefined;
  // A bare size such as "15.6" or "14 W11P": standalone, after the memory/storage figures, never part of a model ("T14").
  const afterSpecs = t.slice(Math.max(0, t.search(/\b\d{1,3} ?(GB|G)\b/)));
  for (const m of afterSpecs.matchAll(/(?<=\s)(\d{2}(?:\.\d)?)(?=\s)(?!\s(?:GB|G|TB|T|W|WH|HZ|MP|IN)\b)/g)) {
    const n = Number(m[1]);
    if (allowed.has(n) && (m[1]!.includes('.') || afterSpecs !== t)) return n;
  }
  return undefined;
}

/** Monitor sizes from model names: Dell P2725H/U2724D → 27, HP E24 G5/Z27K G3 → 24/27, Lenovo T27i-30 → 27. */
function monitorSizeFromModel(t: string): number | undefined {
  const m = t.match(/\b[PSUEGCK](\d{2})\d{2}[A-Z]{0,3}\b/) ?? t.match(/\b[EPMZVX](\d{2})[A-Z]{0,2} G\d\b/) ?? t.match(/\b[TPESLCQG](\d{2})[A-Z]{0,2}-\d{2}\b/);
  const n = m ? Number(m[1]) : NaN;
  return MONITOR_SIZES.has(n) ? n : undefined;
}

function resolution(t: string): string | undefined {
  const checks: [RegExp, string][] = [
    [/\b5K\b|5120 ?X ?2880/, '5K'],
    [/\b4K\b|\bUHD\b|3840 ?X ?2160|WQUXGA|3840 ?X ?2400/, '4K UHD'],
    [/\b2\.8K\b|2880 ?X ?1800/, '2.8K'],
    [/\bWQXGA\b|2560 ?X ?1600|\b2\.5K\b/, 'WQXGA'],
    [/\bW?QHD\+?\b|2560 ?X ?1440/, 'QHD'],
    [/\bWUXGA\b|1920 ?X ?1200|\bFHD\+/, 'WUXGA'],
    [/\bFHD\b|1920 ?X ?1080|\b1080P\b/, 'FHD'],
    [/\bHD\b(?! ?(?:CAM|WEBCAM|GRAPHICS|AUDIO|IR|720P))|1366 ?X ?768/, 'HD'],
  ];
  return checks.find(([re]) => re.test(t))?.[1];
}

function operatingSystem(t: string): string | undefined {
  if (/\bW(?:IN(?:DOWS)?)? ?11 ?P(?:RO)?\w*\b|\b11P\b/.test(t)) return 'Windows 11 Pro';
  if (/\bW(?:IN(?:DOWS)?)? ?11 ?H(?:OME)?\w*\b|\b11H\b/.test(t)) return 'Windows 11 Home';
  if (/\bW(?:IN(?:DOWS)?)? ?10 ?P(?:RO)?\w*\b/.test(t)) return 'Windows 10 Pro';
  if (/\bW(?:IN(?:DOWS)?)? ?11\b/.test(t)) return 'Windows 11';
  if (/\bCHROME ?OS\b|\bCHROMEBOOK\b/.test(t)) return 'ChromeOS';
  if (/\bNO ?OS\b|\bFREE ?DOS\b|\bNOOS\b/.test(t)) return 'No OS';
  if (/\bUBUNTU\b|\bLINUX\b/.test(t)) return 'Linux';
  return undefined;
}

function formFactor(t: string): ProductFacts['formFactor'] | undefined {
  if (/\bAIO\b|\bALL ?-?IN ?-?ONE\b|\bM\d{2}A\b|\bNEO ?\d{2}A\b/.test(t)) return 'All-in-one';
  if (/\bTWR\b|\bTOWER\b|\bMT\b|\bMICRO ?TOWER\b|\bM\d{2}T\b|\bNEO ?\d{2}T\b/.test(t)) return 'Tower';
  if (/\bSFF\b|\bSMALL FORM\b|\bSLIM\b|\bM\d{2}S\b|\bNEO ?\d{2}S\b/.test(t)) return 'Small form factor';
  if (/\bTINY\b|\bMINI\b|\bMICRO\b|\bDM\b|\bUSFF\b|\bULTRA SMALL\b|\bM\d{2}Q\b|\bNEO ?\d{2}Q\b/.test(t)) return 'Mini';
  return undefined;
}

function dockConnection(t: string): ProductFacts['dockConnection'] | undefined {
  if (/THUNDERBOLT ?5|\bTB ?5\b/.test(t)) return 'Thunderbolt 5';
  if (/THUNDERBOLT ?4|\bTB ?4\b|\bWD22TB4\b/.test(t)) return 'Thunderbolt 4';
  if (/THUNDERBOLT ?3|\bTB ?3\b|\bWD19TBS?\b/.test(t)) return 'Thunderbolt 3';
  if (/THUNDERBOLT|\bTB DOCK\b/.test(t)) return 'Thunderbolt';
  if (/\bUSB4\b/.test(t)) return 'USB4';
  if (/USB[- ]?C\b|\bUSBC\b|TYPE[- ]?C\b|\bWD(19|22)\w*\b|\bUD22\b|\bHD22Q\b/.test(t)) return 'USB-C';
  if (/USB[- ]?A\b|USB ?3\.0 DOCK/.test(t)) return 'USB-A';
  return undefined;
}
