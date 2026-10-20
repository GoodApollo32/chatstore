import { describe, expect, it } from 'vitest';
import { factsFromTitle } from '../src/domain/titleFacts.js';

const laptop = (t: string) => factsFromTitle(t, 'Laptops');
const desktop = (t: string) => factsFromTitle(t, 'Desktops');

describe('laptop titles', () => {
  it.each([
    ['TB 15 G2 CI5-1135G7 8/256GB 15.6 W11P', { processorLine: 'Core i5', processorTier: 5, processorModel: 'i5-1135G7', memoryGb: 8, storageGb: 256, screenInches: 15.6, os: 'Windows 11 Pro' }],
    ['THINKPAD T14 G4 I5-1335U 16GB 512GB 14IN WUXGA W11P', { processorModel: 'i5-1335U', memoryGb: 16, storageGb: 512, screenInches: 14, resolution: 'WUXGA', os: 'Windows 11 Pro' }],
    ['TP E14 G5 R5-7530U 16GB 512GB SSD 14IN W11P', { processorBrand: 'AMD', processorLine: 'Ryzen 5', processorTier: 5, processorModel: 'Ryzen 5 7530U', memoryGb: 16, storageGb: 512, storageType: 'SSD', screenInches: 14 }],
    ['TP P16S G2 CU7-155H 32GB 1TB RTX500 ADA 16IN W11P', { processorLine: 'Core Ultra 7', processorModel: 'Ultra 7 155H', memoryGb: 32, storageGb: 1024, graphics: 'NVIDIA RTX 500 Ada', dedicatedGraphics: true, screenInches: 16 }],
    ['HP ELITEBOOK 840 G10 I5-1335U 16GB 512GB 14IN W11P', { processorModel: 'i5-1335U', memoryGb: 16, storageGb: 512, screenInches: 14, os: 'Windows 11 Pro' }],
    ['HP PROBOOK 450 G10 I5 16GB/512 15.6 W11P', { processorLine: 'Core i5', memoryGb: 16, storageGb: 512, screenInches: 15.6 }],
    ['DELL LATITUDE 5450 CU5-125U 16GB 512GB 14IN FHD W11P', { processorLine: 'Core Ultra 5', processorModel: 'Ultra 5 125U', memoryGb: 16, storageGb: 512, screenInches: 14, resolution: 'FHD' }],
    ['LAT 7450 U7-165U 16G 512G 14 W11P', { processorLine: 'Core Ultra 7', memoryGb: 16, storageGb: 512, screenInches: 14, os: 'Windows 11 Pro' }],
    ['DELL PRO 14 ESSENTIAL C5-120U 16GB 512GB W11P', { processorLine: 'Core 5', processorTier: 5, processorModel: 'Core 5 120U', memoryGb: 16, storageGb: 512 }],
    ['HP ZBOOK FIREFLY G11 RYZEN AI 7 PRO 360 32GB 1TB 14IN W11P', { processorLine: 'Ryzen AI 7', processorTier: 7, memoryGb: 32, storageGb: 1024 }],
    ['THINKPAD T14S G6 SNAPDRAGON X ELITE X1E-78-100 32GB 1TB W11P', { processorBrand: 'Qualcomm', processorLine: 'Snapdragon X Elite', processorTier: 7, memoryGb: 32, storageGb: 1024 }],
    ['HP CHROMEBOOK 14 G7 CELERON N4500 4GB 32GB EMMC CHROME', { processorLine: 'Celeron', processorTier: 1, memoryGb: 4, storageGb: 32, storageType: 'eMMC', os: 'ChromeOS' }],
    ['PRECISION 3591 U7-155H 32GB 1TB RTX 2000 ADA 8GB 15.6 W11P', { memoryGb: 32, storageGb: 1024, graphics: 'NVIDIA RTX 2000 Ada', screenInches: 15.6 }],
    ['THINKPAD X13 G4 I5-1345U 16GB 512GB 13.3 4G LTE W11P', { memoryGb: 16, storageGb: 512, screenInches: 13.3 }],
    ['IDEAPAD 1 15AMN7 R3-7320U 8GB 256GB 15.6IN W11H', { processorLine: 'Ryzen 3', processorTier: 3, memoryGb: 8, storageGb: 256, os: 'Windows 11 Home' }],
  ])('%s', (title, expected) => {
    expect(laptop(title)).toMatchObject(expected);
  });

  it('does not invent facts it cannot see', () => {
    const f = laptop('THINKPAD T14 G4');
    expect(f.memoryGb).toBeUndefined();
    expect(f.screenInches).toBeUndefined(); // "T14" is a model name, not a 14" screen
    expect(f.processorTier).toBeUndefined();
  });

  it('copes with a title cut off mid-processor', () => {
    expect(laptop('THINKPAD E16 G2 16IN 16GB 512GB W11P INTEL CORE I')).toMatchObject({ memoryGb: 16, storageGb: 512, screenInches: 16 });
  });

  it('does not take a "16 GB" with a space for a 16-inch screen, or an HD webcam for an HD screen', () => {
    const f = laptop('LATITUDE 3550 I5-1335U 16 GB 512 GB HD CAM W11P');
    expect(f.memoryGb).toBe(16);
    expect(f.screenInches).toBeUndefined();
    expect(f.resolution).toBeUndefined();
  });
});

describe('desktop titles', () => {
  it.each([
    ['THINKCENTRE M70Q G4 I5-13400T 16GB 512GB W11P', { formFactor: 'Mini', processorModel: 'i5-13400T', memoryGb: 16, storageGb: 512 }],
    ['THINKCENTRE M90T G4 TWR I7-13700 32GB 1TB W11P', { formFactor: 'Tower', processorTier: 7, memoryGb: 32, storageGb: 1024 }],
    ['THINKSTATION P3 TWR I7-13700 32GB 1TB RTX A2000 12GB W11P', { formFactor: 'Tower', memoryGb: 32, storageGb: 1024, graphics: 'NVIDIA RTX A2000', dedicatedGraphics: true }],
    ['HP ELITEDESK 800 G9 SFF I5-12500 16GB 512GB W11P', { formFactor: 'Small form factor', memoryGb: 16, storageGb: 512 }],
    ['HP PRODESK 400 G9 DM I5-12500T 8GB 256GB W11P', { formFactor: 'Mini', memoryGb: 8, storageGb: 256 }],
    ['HP Z2 G9 TWR I7-13700 32GB 1TB NVIDIA T1000 W11P', { formFactor: 'Tower', graphics: 'NVIDIA T1000', dedicatedGraphics: true, memoryGb: 32 }],
    ['OPTIPLEX 7020 SFF I5-14500 16GB 512GB W11P', { formFactor: 'Small form factor', processorModel: 'i5-14500', memoryGb: 16, storageGb: 512 }],
    ['OPTIPLEX MICRO 7020 I5-14500T 8GB 256GB W11P', { formFactor: 'Mini', memoryGb: 8, storageGb: 256 }],
    ['DELL PRO SLIM I7-14700 16GB 512GB W11P', { formFactor: 'Small form factor', processorTier: 7 }],
    ['HP PROONE 440 G9 AIO 23.8IN I5-12500T 16GB 512GB W11P', { formFactor: 'All-in-one', screenInches: 23.8, memoryGb: 16 }],
    ['PRECISION 3680 TWR XEON W3-2423 64GB 2TB W11P', { formFactor: 'Tower', processorLine: 'Xeon', processorModel: 'Xeon W3-2423', memoryGb: 64, storageGb: 2048 }],
    ['HP PRODESK 405 G8 SFF R5 5600GE 8GB 256GB W11P', { formFactor: 'Small form factor', processorLine: 'Ryzen 5', memoryGb: 8, storageGb: 256 }],
  ])('%s', (title, expected) => {
    expect(desktop(title)).toMatchObject(expected);
  });

  it('does not read a processor model as storage', () => {
    expect(desktop('OPTIPLEX 7010 MT I5-12500T 8GB').storageGb).toBeUndefined();
  });
});

describe('monitor titles', () => {
  const monitor = (t: string) => factsFromTitle(t, 'Monitors');
  it.each([
    ['THINKVISION T27I-30 27IN FHD IPS 75HZ HDMI DP', { screenInches: 27, resolution: 'FHD', panel: 'IPS', refreshHz: 75 }],
    ['HP E24 G5 23.8IN FHD IPS MONITOR', { screenInches: 23.8, resolution: 'FHD', panel: 'IPS' }],
    ['DELL P2725HE 27 USB-C HUB MONITOR', { screenInches: 27, usbC: true }],
    ['HP Z27K G3 4K UHD USB-C', { screenInches: 27, resolution: '4K UHD', usbC: true }],
    ['DELL ULTRASHARP U2724D QHD IPS 120HZ', { screenInches: 27, resolution: 'QHD', refreshHz: 120 }],
  ])('%s', (title, expected) => {
    expect(monitor(title)).toMatchObject(expected);
  });
});

describe('docking station titles', () => {
  const dock = (t: string) => factsFromTitle(t, 'Docking Stations');
  it.each([
    ['THINKPAD UNIVERSAL USB-C DOCK 90W', { dockConnection: 'USB-C', powerW: 90 }],
    ['THINKPAD THUNDERBOLT 4 WORKSTATION DOCK 230W', { dockConnection: 'Thunderbolt 4', powerW: 230 }],
    ['HP TB DOCK 280W G4 W/ COMBO CABLE', { dockConnection: 'Thunderbolt', powerW: 280 }],
    ['DELL DOCK WD19S 130W', { dockConnection: 'USB-C', powerW: 130 }],
    ['DELL THUNDERBOLT DOCK WD22TB4', { dockConnection: 'Thunderbolt 4' }],
  ])('%s', (title, expected) => {
    expect(dock(title)).toMatchObject(expected);
  });
});
