/**
 * Green Button Data Integration Service
 *
 * Supports Green Button Connect My Data (CMD) and Download My Data (DMD)
 * for Ontario utility providers.
 *
 * Green Button is an industry-standard (NAESB REQ.21 / ESPI) that uses
 * OAuth 2.0 + Atom/XML feeds to provide energy usage data.
 * OEB mandated all Ontario LDCs to support Green Button by Nov 1, 2023.
 *
 * Supported Providers (16):
 * GTA:       Toronto Hydro, Hydro One, Alectra
 * Waterloo:  Enova Power (Kitchener/Waterloo), Energy+ (Cambridge), Kitchener Utilities (gas/water)
 * Gas:       Enbridge Gas (Ontario-wide)
 * Ottawa:    Hydro Ottawa
 * London:    London Hydro (GBA Sponsor)
 * Durham:    Elexicon Energy, Oshawa PUC
 * Niagara:   Niagara Peninsula Energy
 * Halton:    Burlington Hydro
 * Eastern:   Utilities Kingston
 * Northern:  Greater Sudbury Hydro, Thunder Bay Hydro
 */

import { encrypt, decrypt } from "./encryption";
import { XMLParser } from "fast-xml-parser";

// ═══════════════════════════════════════════════════════════
//  PROVIDER REGISTRY — Ontario Utilities
// ═══════════════════════════════════════════════════════════

export interface GreenButtonProvider {
    id: string;
    name: string;
    shortName: string;
    utilityType: "HYDRO" | "WATER_GAS" | "INTERNET";
    region: string;
    // OAuth2 configuration
    authorizationEndpoint: string;
    tokenEndpoint: string;
    resourceEndpoint: string;
    // Registration info
    registrationUrl: string;
    customerPortalUrl: string;
    // Capabilities
    supportsCMD: boolean;         // Connect My Data (OAuth API)
    supportsDMD: boolean;         // Download My Data (XML file upload)
    supportsInterval: boolean;    // Interval (hourly) data
    supportsBilling: boolean;     // Billing/cost data
    // Scopes
    scopes: string[];
    // Notes
    notes: string;
}

export const GTA_PROVIDERS: GreenButtonProvider[] = [
    // ── GTA (Greater Toronto Area) ──
    {
        id: "toronto_hydro",
        name: "Toronto Hydro-Electric System",
        shortName: "Toronto Hydro",
        utilityType: "HYDRO",
        region: "Toronto, ON",
        authorizationEndpoint: "https://css.torontohydro.com/greenbutton/oauth/authorize",
        tokenEndpoint: "https://css.torontohydro.com/greenbutton/oauth/token",
        resourceEndpoint: "https://css.torontohydro.com/greenbutton/espi/1_1/resource",
        registrationUrl: "https://torontoonboarding.savagedata.com/",
        customerPortalUrl: "https://www.torontohydro.com/my-account/green-button-data",
        supportsCMD: true,
        supportsDMD: true,
        supportsInterval: true,
        supportsBilling: true,
        scopes: ["FB=1_3_4_5_8_13_14_18_19_31_32_35_37_38_39_40_41_44"],
        notes: "Full CMD certified. Register as third-party via Savage Data onboarding portal.",
    },
    {
        id: "hydro_one",
        name: "Hydro One Networks",
        shortName: "Hydro One",
        utilityType: "HYDRO",
        region: "GTA Suburbs & Rural Ontario",
        authorizationEndpoint: "https://www.hydroone.com/greenbutton/oauth/authorize",
        tokenEndpoint: "https://www.hydroone.com/greenbutton/oauth/token",
        resourceEndpoint: "https://www.hydroone.com/greenbutton/espi/1_1/resource",
        registrationUrl: "https://www.hydroone.com/myaccount/myhome/green-button",
        customerPortalUrl: "https://www.hydroone.com/myaccount",
        supportsCMD: false,
        supportsDMD: true,
        supportsInterval: true,
        supportsBilling: false,
        scopes: ["FB=1_3_4_5_13_14_18_19_31_32_35_37_38_39_40_41_44"],
        notes: "DMD only — customers download XML from account portal. Serves suburban GTA and rural Ontario.",
    },
    {
        id: "alectra",
        name: "Alectra Utilities",
        shortName: "Alectra",
        utilityType: "HYDRO",
        region: "Mississauga, Brampton, Hamilton, Vaughan, Markham, Guelph, St. Catharines",
        authorizationEndpoint: "https://myalectra.alectrautilities.com/greenbutton/oauth/authorize",
        tokenEndpoint: "https://myalectra.alectrautilities.com/greenbutton/oauth/token",
        resourceEndpoint: "https://myalectra.alectrautilities.com/greenbutton/espi/1_1/resource",
        registrationUrl: "https://myalectra.alectrautilities.com/greenbutton/register",
        customerPortalUrl: "https://myalectra.alectrautilities.com/",
        supportsCMD: true,
        supportsDMD: true,
        supportsInterval: true,
        supportsBilling: true,
        scopes: ["FB=1_3_4_5_8_13_14_18_19_31_32_35_37_38_39_40_41_44"],
        notes: "CMD supported. Also serves Guelph (merged Guelph Hydro). Large multi-region LDC.",
    },

    // ── Waterloo Region ──
    {
        id: "enova_power",
        name: "Enova Power Corp",
        shortName: "Enova Power",
        utilityType: "HYDRO",
        region: "Kitchener, Waterloo, Woolwich, Wellesley, Wilmot, ON",
        authorizationEndpoint: "https://myaccount.enovapower.com/greenbutton/oauth/authorize",
        tokenEndpoint: "https://myaccount.enovapower.com/greenbutton/oauth/token",
        resourceEndpoint: "https://myaccount.enovapower.com/greenbutton/espi/1_1/resource",
        registrationUrl: "https://enovapower.com/my-account/",
        customerPortalUrl: "https://enovapower.com/my-account/",
        supportsCMD: false,
        supportsDMD: true,
        supportsInterval: true,
        supportsBilling: true,
        scopes: ["FB=1_3_4_5_13_14_18_19_31_32_35_37_38_39_40_41_44"],
        notes: "Merged Kitchener-Wilmot Hydro + Waterloo North Hydro. DMD via My Account portal. OEB-mandated Green Button.",
    },
    {
        id: "energy_plus",
        name: "Energy+ Inc.",
        shortName: "Energy+",
        utilityType: "HYDRO",
        region: "Cambridge, North Dumfries, ON",
        authorizationEndpoint: "https://myaccount.energyplus.ca/greenbutton/oauth/authorize",
        tokenEndpoint: "https://myaccount.energyplus.ca/greenbutton/oauth/token",
        resourceEndpoint: "https://myaccount.energyplus.ca/greenbutton/espi/1_1/resource",
        registrationUrl: "https://www.energyplus.ca/myaccount",
        customerPortalUrl: "https://www.energyplus.ca/myaccount",
        supportsCMD: false,
        supportsDMD: true,
        supportsInterval: true,
        supportsBilling: true,
        scopes: ["FB=1_3_4_5_13_14_18_19_31_32_35_37_38_39_40_41_44"],
        notes: "Serves Cambridge and North Dumfries. DMD via customer portal. OEB-mandated Green Button.",
    },
    {
        id: "kitchener_utilities",
        name: "Kitchener Utilities",
        shortName: "Kitchener Utilities",
        utilityType: "WATER_GAS",
        region: "Kitchener, ON",
        authorizationEndpoint: "https://billing.kitchener.ca/Portal/greenbutton/oauth/authorize",
        tokenEndpoint: "https://billing.kitchener.ca/Portal/greenbutton/oauth/token",
        resourceEndpoint: "https://billing.kitchener.ca/Portal/greenbutton/espi/1_1/resource",
        registrationUrl: "https://billing.kitchener.ca/Portal/",
        customerPortalUrl: "https://www.kitchenerutilities.ca/en/my-account.aspx",
        supportsCMD: true,
        supportsDMD: true,
        supportsInterval: false,
        supportsBilling: true,
        scopes: ["FB=1_4_5_8_13_14_18_19_32_35"],
        notes: "City of Kitchener — natural gas, water, stormwater, sewer. CMD + DMD via e-billing portal. Third-party app registration available.",
    },

    // ── Ontario-wide Gas ──
    {
        id: "enbridge_gas",
        name: "Enbridge Gas Inc.",
        shortName: "Enbridge Gas",
        utilityType: "WATER_GAS",
        region: "Ontario-wide (Gas)",
        authorizationEndpoint: "https://myaccount.enbridgegas.com/greenbutton/oauth/authorize",
        tokenEndpoint: "https://myaccount.enbridgegas.com/greenbutton/oauth/token",
        resourceEndpoint: "https://myaccount.enbridgegas.com/greenbutton/espi/1_1/resource",
        registrationUrl: "https://www.enbridgegas.com/green-button",
        customerPortalUrl: "https://myaccount.enbridgegas.com/",
        supportsCMD: true,
        supportsDMD: true,
        supportsInterval: false,
        supportsBilling: true,
        scopes: ["FB=1_4_5_8_13_14_18_19_32_35"],
        notes: "GBA Sponsor Member. CMD certified for gas usage and billing data. Covers all of Ontario.",
    },

    // ── Ottawa ──
    {
        id: "hydro_ottawa",
        name: "Hydro Ottawa Limited",
        shortName: "Hydro Ottawa",
        utilityType: "HYDRO",
        region: "Ottawa, Casselman, ON",
        authorizationEndpoint: "https://myaccount.hydroottawa.com/greenbutton/oauth/authorize",
        tokenEndpoint: "https://myaccount.hydroottawa.com/greenbutton/oauth/token",
        resourceEndpoint: "https://myaccount.hydroottawa.com/greenbutton/espi/1_1/resource",
        registrationUrl: "https://hydroottawa.com/accounts-and-billing/my-account",
        customerPortalUrl: "https://hydroottawa.com/accounts-and-billing/my-account",
        supportsCMD: false,
        supportsDMD: true,
        supportsInterval: true,
        supportsBilling: true,
        scopes: ["FB=1_3_4_5_13_14_18_19_31_32_35_37_38_39_40_41_44"],
        notes: "3rd largest municipally-owned LDC in Ontario. ~345,000 customers. DMD via account portal.",
    },

    // ── London ──
    {
        id: "london_hydro",
        name: "London Hydro Inc.",
        shortName: "London Hydro",
        utilityType: "HYDRO",
        region: "London, ON",
        authorizationEndpoint: "https://myaccount.londonhydro.com/greenbutton/oauth/authorize",
        tokenEndpoint: "https://myaccount.londonhydro.com/greenbutton/oauth/token",
        resourceEndpoint: "https://myaccount.londonhydro.com/greenbutton/espi/1_1/resource",
        registrationUrl: "https://www.londonhydro.com/myaccount",
        customerPortalUrl: "https://www.londonhydro.com/myaccount",
        supportsCMD: true,
        supportsDMD: true,
        supportsInterval: true,
        supportsBilling: true,
        scopes: ["FB=1_3_4_5_8_13_14_18_19_31_32_35_37_38_39_40_41_44"],
        notes: "GBA Sponsor Member. CMD + DMD certified. Supports electricity, gas, and water data. ~166,000 customers.",
    },

    // ── Durham Region ──
    {
        id: "elexicon",
        name: "Elexicon Energy Inc.",
        shortName: "Elexicon",
        utilityType: "HYDRO",
        region: "Ajax, Pickering, Whitby, Belleville, Gravenhurst, ON",
        authorizationEndpoint: "https://myaccount.elexiconenergy.com/greenbutton/oauth/authorize",
        tokenEndpoint: "https://myaccount.elexiconenergy.com/greenbutton/oauth/token",
        resourceEndpoint: "https://myaccount.elexiconenergy.com/greenbutton/espi/1_1/resource",
        registrationUrl: "https://elexiconenergy.com/for-home/account-billing/track-your-usage",
        customerPortalUrl: "https://elexiconenergy.com/for-home/account-billing",
        supportsCMD: false,
        supportsDMD: true,
        supportsInterval: true,
        supportsBilling: true,
        scopes: ["FB=1_3_4_5_13_14_18_19_31_32_35_37_38_39_40_41_44"],
        notes: "Merged Veridian + Whitby Hydro. Serves Durham Region and Quinte area. DMD via portal.",
    },
    {
        id: "oshawa_puc",
        name: "Oshawa PUC Networks Inc.",
        shortName: "Oshawa PUC",
        utilityType: "HYDRO",
        region: "Oshawa, ON",
        authorizationEndpoint: "https://myaccount.opuc.on.ca/greenbutton/oauth/authorize",
        tokenEndpoint: "https://myaccount.opuc.on.ca/greenbutton/oauth/token",
        resourceEndpoint: "https://myaccount.opuc.on.ca/greenbutton/espi/1_1/resource",
        registrationUrl: "https://www.opuc.on.ca/myaccount",
        customerPortalUrl: "https://www.opuc.on.ca/myaccount",
        supportsCMD: false,
        supportsDMD: true,
        supportsInterval: true,
        supportsBilling: true,
        scopes: ["FB=1_3_4_5_13_14_18_19_31_32_35_37_38_39_40_41_44"],
        notes: "Serves Oshawa. DMD via My Account portal. OEB-mandated Green Button.",
    },

    // ── Niagara ──
    {
        id: "niagara_peninsula",
        name: "Niagara Peninsula Energy Inc.",
        shortName: "NPEI",
        utilityType: "HYDRO",
        region: "Niagara Falls, Fort Erie, Port Colborne, ON",
        authorizationEndpoint: "https://myaccount.npei.ca/greenbutton/oauth/authorize",
        tokenEndpoint: "https://myaccount.npei.ca/greenbutton/oauth/token",
        resourceEndpoint: "https://myaccount.npei.ca/greenbutton/espi/1_1/resource",
        registrationUrl: "https://www.npei.ca/myaccount",
        customerPortalUrl: "https://www.npei.ca/myaccount",
        supportsCMD: false,
        supportsDMD: true,
        supportsInterval: true,
        supportsBilling: true,
        scopes: ["FB=1_3_4_5_13_14_18_19_31_32_35_37_38_39_40_41_44"],
        notes: "Serves Niagara region. DMD via customer portal. OEB-mandated Green Button.",
    },

    // ── Burlington ──
    {
        id: "burlington_hydro",
        name: "Burlington Hydro Inc.",
        shortName: "Burlington Hydro",
        utilityType: "HYDRO",
        region: "Burlington, ON",
        authorizationEndpoint: "https://myaccount.burlingtonhydro.com/greenbutton/oauth/authorize",
        tokenEndpoint: "https://myaccount.burlingtonhydro.com/greenbutton/oauth/token",
        resourceEndpoint: "https://myaccount.burlingtonhydro.com/greenbutton/espi/1_1/resource",
        registrationUrl: "https://www.burlingtonhydro.com/myaccount",
        customerPortalUrl: "https://www.burlingtonhydro.com/myaccount",
        supportsCMD: false,
        supportsDMD: true,
        supportsInterval: true,
        supportsBilling: true,
        scopes: ["FB=1_3_4_5_13_14_18_19_31_32_35_37_38_39_40_41_44"],
        notes: "Serves Burlington. ~67,000 customers. DMD via portal. OEB-mandated Green Button.",
    },

    // ── Kingston ──
    {
        id: "utilities_kingston",
        name: "Utilities Kingston",
        shortName: "Utilities Kingston",
        utilityType: "HYDRO",
        region: "Kingston, ON",
        authorizationEndpoint: "https://myaccount.utilitieskingston.com/greenbutton/oauth/authorize",
        tokenEndpoint: "https://myaccount.utilitieskingston.com/greenbutton/oauth/token",
        resourceEndpoint: "https://myaccount.utilitieskingston.com/greenbutton/espi/1_1/resource",
        registrationUrl: "https://utilitieskingston.com/MyAccount",
        customerPortalUrl: "https://utilitieskingston.com/MyAccount",
        supportsCMD: false,
        supportsDMD: true,
        supportsInterval: true,
        supportsBilling: true,
        scopes: ["FB=1_3_4_5_13_14_18_19_31_32_35_37_38_39_40_41_44"],
        notes: "Serves Kingston. Provides electricity, water, gas, and wastewater. DMD via My Account.",
    },

    // ── Northern Ontario ──
    {
        id: "greater_sudbury_hydro",
        name: "Greater Sudbury Hydro Inc.",
        shortName: "Sudbury Hydro",
        utilityType: "HYDRO",
        region: "Greater Sudbury, ON",
        authorizationEndpoint: "https://myaccount.gshydro.com/greenbutton/oauth/authorize",
        tokenEndpoint: "https://myaccount.gshydro.com/greenbutton/oauth/token",
        resourceEndpoint: "https://myaccount.gshydro.com/greenbutton/espi/1_1/resource",
        registrationUrl: "https://www.gshydro.com/myaccount",
        customerPortalUrl: "https://www.gshydro.com/myaccount",
        supportsCMD: false,
        supportsDMD: true,
        supportsInterval: true,
        supportsBilling: false,
        scopes: ["FB=1_3_4_5_13_14_18_19_31_32_35_37_38_39_40_41_44"],
        notes: "Serves Greater Sudbury. ~47,000 customers. DMD via portal. OEB-mandated Green Button.",
    },
    {
        id: "thunder_bay_hydro",
        name: "Thunder Bay Hydro",
        shortName: "Thunder Bay Hydro",
        utilityType: "HYDRO",
        region: "Thunder Bay, ON",
        authorizationEndpoint: "https://myaccount.tbhydro.on.ca/greenbutton/oauth/authorize",
        tokenEndpoint: "https://myaccount.tbhydro.on.ca/greenbutton/oauth/token",
        resourceEndpoint: "https://myaccount.tbhydro.on.ca/greenbutton/espi/1_1/resource",
        registrationUrl: "https://www.tbhydro.on.ca/myaccount",
        customerPortalUrl: "https://www.tbhydro.on.ca/myaccount",
        supportsCMD: false,
        supportsDMD: true,
        supportsInterval: true,
        supportsBilling: false,
        scopes: ["FB=1_3_4_5_13_14_18_19_31_32_35_37_38_39_40_41_44"],
        notes: "Serves Thunder Bay. ~52,000 customers. DMD via portal. OEB-mandated Green Button.",
    },
];

// ═══════════════════════════════════════════════════════════
//  GREEN BUTTON XML PARSER
// ═══════════════════════════════════════════════════════════

export interface GBUsagePoint {
    title: string;
    href: string;
    serviceCategory: string;   // "0" = electricity, "1" = gas, "2" = water
    status: string;
}

export interface GBIntervalReading {
    start: Date;
    duration: number;      // seconds
    value: number;         // raw value
    unit: string;          // "Wh", "m³", etc.
    cost?: number;         // cents
    quality?: string;
}

export interface GBUsageSummary {
    billingPeriodStart: Date;
    billingPeriodEnd: Date;
    totalCost: number;     // cents
    totalUsage: number;
    usageUnit: string;
    currency: string;
    qualityOfReading: string;
}

export interface GBParsedData {
    usagePoints: GBUsagePoint[];
    intervalReadings: GBIntervalReading[];
    usageSummaries: GBUsageSummary[];
    rawXml?: string;
}

/**
 * Parse Green Button ESPI XML data into structured objects.
 * Uses fast-xml-parser for reliable parsing of Atom/XML with ESPI namespace.
 */
export function parseGreenButtonXml(xml: string): GBParsedData {
    const result: GBParsedData = {
        usagePoints: [],
        intervalReadings: [],
        usageSummaries: [],
    };

    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        removeNSPrefix: true,        // Strip namespace prefixes (espi:, atom:, etc.)
        isArray: (name) => ["entry", "IntervalReading", "IntervalBlock", "UsageSummary", "link"].includes(name),
        parseTagValue: true,
        numberParseOptions: { hex: false, leadingZeros: false },
    });

    let parsed: any;
    try {
        parsed = parser.parse(xml);
    } catch (err) {
        console.warn("[GreenButton] XML parse error:", (err as Error).message);
        return result;
    }

    // Navigate to entries — handle both <feed><entry> and bare <entry> structures
    const feed = parsed?.feed || parsed?.Feed || parsed;
    const entries: any[] = toArray(feed?.entry || feed?.Entry || []);

    for (const entry of entries) {
        const content = entry?.content || entry?.Content || {};
        const title = extractText(entry?.title || entry?.Title) || "Unknown";
        const links = toArray(entry?.link || entry?.Link || []);
        const href = links.find((l: any) => l?.["@_rel"] === "self" || l?.["@_href"])?.["@_href"] || "";

        // ── UsagePoint ──
        const up = content?.UsagePoint;
        if (up) {
            const kind = up?.ServiceCategory?.kind ?? up?.serviceCategory?.kind ?? "0";
            result.usagePoints.push({
                title,
                href,
                serviceCategory: String(kind),
                status: "active",
            });
        }

        // ── IntervalBlock → IntervalReading ──
        const ib = content?.IntervalBlock;
        if (ib) {
            const blocks = toArray(ib);
            for (const block of blocks) {
                const readings = toArray(block?.IntervalReading || []);
                for (const r of readings) {
                    const tp = r?.timePeriod || {};
                    const startEpoch = Number(tp?.start || 0);
                    const duration = Number(tp?.duration || 0);
                    const value = Number(r?.value ?? 0);
                    const cost = r?.cost != null ? Number(r.cost) : undefined;
                    const quality = r?.ReadingQuality?.quality ? String(r.ReadingQuality.quality) : undefined;
                    if (startEpoch > 0) {
                        result.intervalReadings.push({
                            start: new Date(startEpoch * 1000),
                            duration,
                            value,
                            unit: detectUnitFromParsed(content) || detectUnitFromXml(xml),
                            cost,
                            quality,
                        });
                    }
                }
            }
        }

        // ── Also check for IntervalReading directly under content ──
        const directReadings = toArray(content?.IntervalReading || []);
        for (const r of directReadings) {
            const tp = r?.timePeriod || {};
            const startEpoch = Number(tp?.start || 0);
            const duration = Number(tp?.duration || 0);
            const value = Number(r?.value ?? 0);
            const cost = r?.cost != null ? Number(r.cost) : undefined;
            if (startEpoch > 0) {
                result.intervalReadings.push({
                    start: new Date(startEpoch * 1000),
                    duration,
                    value,
                    unit: detectUnitFromParsed(content) || detectUnitFromXml(xml),
                    cost,
                });
            }
        }

        // ── UsageSummary ──
        const us = content?.UsageSummary;
        if (us) {
            const summaries = toArray(us);
            for (const s of summaries) {
                const bp = s?.billingPeriod || {};
                const startEpoch = Number(bp?.start || 0);
                const durationSec = Number(bp?.duration || 0);

                // Overall consumption
                const consumption = s?.overallConsumptionLastPeriod || {};
                const multiplier = Number(consumption?.powerOfTenMultiplier || 0);
                const uom = Number(consumption?.uom || 0);
                const rawValue = Number(consumption?.value || 0);

                // Cost — check multiple possible fields
                const cost = Number(s?.costAdditionalLastPeriod || s?.totalCost || s?.billLastPeriod || 0);

                // Currency
                const currency = s?.currency ? String(s.currency) : "CAD";
                const qualityStr = s?.qualityOfReading ? String(s.qualityOfReading) : "validated";

                if (startEpoch > 0) {
                    result.usageSummaries.push({
                        billingPeriodStart: new Date(startEpoch * 1000),
                        billingPeriodEnd: new Date((startEpoch + durationSec) * 1000),
                        totalCost: cost,
                        totalUsage: rawValue * Math.pow(10, multiplier),
                        usageUnit: uomToUnit(uom),
                        currency,
                        qualityOfReading: qualityStr,
                    });
                }
            }
        }

        // ── ElectricPowerUsageSummary (alternate ESPI format) ──
        const epus = content?.ElectricPowerUsageSummary;
        if (epus) {
            const summaries = toArray(epus);
            for (const s of summaries) {
                const bp = s?.billingPeriod || {};
                const startEpoch = Number(bp?.start || 0);
                const durationSec = Number(bp?.duration || 0);
                const consumption = s?.overallConsumptionLastPeriod || {};
                const multiplier = Number(consumption?.powerOfTenMultiplier || 0);
                const uom = Number(consumption?.uom || 132); // default kWh
                const rawValue = Number(consumption?.value || 0);
                const cost = Number(s?.costAdditionalLastPeriod || s?.billLastPeriod || 0);

                if (startEpoch > 0) {
                    result.usageSummaries.push({
                        billingPeriodStart: new Date(startEpoch * 1000),
                        billingPeriodEnd: new Date((startEpoch + durationSec) * 1000),
                        totalCost: cost,
                        totalUsage: rawValue * Math.pow(10, multiplier),
                        usageUnit: uomToUnit(uom),
                        currency: "CAD",
                        qualityOfReading: "validated",
                    });
                }
            }
        }
    }

    return result;
}

/** Helper: ensure value is always an array */
function toArray(val: any): any[] {
    if (Array.isArray(val)) return val;
    if (val == null || val === "") return [];
    return [val];
}

/** Helper: extract text from Atom title (can be string or {#text: ...}) */
function extractText(val: any): string {
    if (typeof val === "string") return val;
    if (val?.["#text"]) return String(val["#text"]);
    if (val?._) return String(val._);
    return "";
}

/** Detect UOM from parsed content object */
function detectUnitFromParsed(content: any): string | null {
    const rt = content?.ReadingType;
    if (rt?.uom != null) return uomToUnit(Number(rt.uom));
    return null;
}

/** Map ESPI UOM codes to human-readable units */
function uomToUnit(uom: number): string {
    const map: Record<number, string> = {
        72: "Wh",       // Watt-hours
        119: "W",       // Watts (active power)
        169: "VA",       // Volt-Amperes
        132: "kWh",     // kilowatt-hours
        33: "m³",       // Cubic meters (gas)
        65: "therms",   // Therms
        125: "GJ",       // Gigajoules
    };
    return map[uom] || "units";
}

/** Detect the measurement unit from the ReadingType in XML */
function detectUnitFromXml(xml: string): string {
    const rtMatch = xml.match(/<uom>(\d+)<\/uom>/);
    if (rtMatch) return uomToUnit(parseInt(rtMatch[1]));
    return "Wh";
}

// ═══════════════════════════════════════════════════════════
//  OAUTH2 FLOW — Connect My Data
// ═══════════════════════════════════════════════════════════

/**
 * Build the OAuth authorization URL for a provider.
 * The landlord will redirect to this URL to authorize NestMind
 * as a third-party to access their utility data.
 */
export function buildAuthorizationUrl(
    provider: GreenButtonProvider,
    params: {
        clientId: string;
        redirectUri: string;
        state: string;
    },
): string {
    const url = new URL(provider.authorizationEndpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", params.clientId);
    url.searchParams.set("redirect_uri", params.redirectUri);
    url.searchParams.set("scope", provider.scopes.join(" "));
    url.searchParams.set("state", params.state);
    return url.toString();
}

/**
 * Exchange an authorization code for access & refresh tokens.
 */
export async function exchangeCodeForTokens(
    provider: GreenButtonProvider,
    params: {
        code: string;
        clientId: string;
        clientSecret: string;
        redirectUri: string;
    },
): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    scope: string;
    subscriptionId?: string;
    resourceUri?: string;
}> {
    const body = new URLSearchParams({
        grant_type: "authorization_code",
        code: params.code,
        redirect_uri: params.redirectUri,
        client_id: params.clientId,
        client_secret: params.clientSecret,
    });

    const resp = await fetch(provider.tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
    });

    if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Token exchange failed (${resp.status}): ${errText}`);
    }

    const data = await resp.json();
    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in || 3600,
        scope: data.scope || "",
        subscriptionId: data.subscriptionId || data.subscription_id,
        resourceUri: data.resourceURI || data.resource_uri,
    };
}

/**
 * Refresh an expired access token.
 */
export async function refreshAccessToken(
    provider: GreenButtonProvider,
    params: {
        refreshToken: string;
        clientId: string;
        clientSecret: string;
    },
): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
}> {
    const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: params.refreshToken,
        client_id: params.clientId,
        client_secret: params.clientSecret,
    });

    const resp = await fetch(provider.tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
    });

    if (!resp.ok) {
        throw new Error(`Token refresh failed (${resp.status})`);
    }

    const data = await resp.json();
    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || params.refreshToken,
        expiresIn: data.expires_in || 3600,
    };
}

// ═══════════════════════════════════════════════════════════
//  DATA FETCHING — Green Button API
// ═══════════════════════════════════════════════════════════

/**
 * Fetch Green Button usage data from a provider's API.
 * Uses the standard ESPI REST endpoints.
 */
export async function fetchUsageData(
    provider: GreenButtonProvider,
    params: {
        accessToken: string;
        subscriptionId?: string;
        usagePointId?: string;
        startDate?: Date;
        endDate?: Date;
    },
): Promise<GBParsedData> {
    let url = provider.resourceEndpoint;

    // Build the correct ESPI path
    if (params.subscriptionId) {
        url += `/Subscription/${params.subscriptionId}`;
        if (params.usagePointId) {
            url += `/UsagePoint/${params.usagePointId}`;
        }
    } else {
        url += "/Batch/Subscription";
    }

    const headers: Record<string, string> = {
        Authorization: `Bearer ${params.accessToken}`,
        Accept: "application/atom+xml",
    };

    // Add date range query params if provided
    const fetchUrl = new URL(url);
    if (params.startDate) {
        fetchUrl.searchParams.set("published-min", params.startDate.toISOString());
    }
    if (params.endDate) {
        fetchUrl.searchParams.set("published-max", params.endDate.toISOString());
    }

    const resp = await fetch(fetchUrl.toString(), { headers });
    if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Green Button API error (${resp.status}): ${errText.slice(0, 200)}`);
    }

    const xml = await resp.text();
    const parsed = parseGreenButtonXml(xml);
    parsed.rawXml = xml;
    return parsed;
}

// ═══════════════════════════════════════════════════════════
//  DMD — Download My Data (XML file parsing)
// ═══════════════════════════════════════════════════════════

/**
 * Parse an uploaded Green Button XML file (Download My Data).
 * Landlords can download XML from their utility portal and upload it.
 */
export function parseUploadedGreenButtonFile(xmlContent: string): GBParsedData {
    return parseGreenButtonXml(xmlContent);
}

/**
 * Convert parsed Green Button data into utility bills for storage.
 */
export function convertToBills(
    parsed: GBParsedData,
    meta: {
        unitId: string;
        landlordId: string;
        provider: string;
        utilityType: "HYDRO" | "WATER_GAS";
    },
): Array<{
    utilityType: string;
    amountCents: number;
    currency: string;
    usageAmount: number;
    usageUnit: string;
    billingPeriodStart: Date;
    billingPeriodEnd: Date;
    unitId: string;
    landlordId: string;
    rawData: Record<string, unknown>;
}> {
    // Prefer usage summaries (billing-level), fall back to aggregated interval data
    if (parsed.usageSummaries.length > 0) {
        return parsed.usageSummaries.map((s) => ({
            utilityType: meta.utilityType,
            amountCents: s.totalCost,
            currency: s.currency,
            usageAmount: s.totalUsage,
            usageUnit: s.usageUnit,
            billingPeriodStart: s.billingPeriodStart,
            billingPeriodEnd: s.billingPeriodEnd,
            unitId: meta.unitId,
            landlordId: meta.landlordId,
            rawData: { source: "green_button", provider: meta.provider, qualityOfReading: s.qualityOfReading },
        }));
    }

    // Aggregate interval readings into monthly buckets
    if (parsed.intervalReadings.length > 0) {
        const monthly = new Map<string, { total: number; cost: number; unit: string; start: Date; end: Date }>();

        for (const r of parsed.intervalReadings) {
            const key = `${r.start.getFullYear()}-${String(r.start.getMonth() + 1).padStart(2, "0")}`;
            const existing = monthly.get(key);
            if (existing) {
                existing.total += r.value;
                existing.cost += r.cost || 0;
                existing.end = r.start > existing.end ? r.start : existing.end;
            } else {
                monthly.set(key, {
                    total: r.value,
                    cost: r.cost || 0,
                    unit: r.unit,
                    start: r.start,
                    end: r.start,
                });
            }
        }

        return Array.from(monthly.entries()).map(([, v]) => ({
            utilityType: meta.utilityType,
            amountCents: v.cost,
            currency: "CAD",
            usageAmount: v.total,
            usageUnit: v.unit,
            billingPeriodStart: v.start,
            billingPeriodEnd: v.end,
            unitId: meta.unitId,
            landlordId: meta.landlordId,
            rawData: { source: "green_button", provider: meta.provider, aggregated: true },
        }));
    }

    return [];
}

// ═══════════════════════════════════════════════════════════
//  UTILITY HELPERS
// ═══════════════════════════════════════════════════════════

export function getProvider(providerId: string): GreenButtonProvider | undefined {
    return GTA_PROVIDERS.find((p) => p.id === providerId);
}

export function getProvidersByType(utilityType: string): GreenButtonProvider[] {
    return GTA_PROVIDERS.filter((p) => p.utilityType === utilityType);
}

export function getProvidersForRegion(city: string): GreenButtonProvider[] {
    const lower = city.toLowerCase();
    return GTA_PROVIDERS.filter((p) => p.region.toLowerCase().includes(lower));
}

/** Encrypt tokens before storing in DB */
export function encryptToken(token: string): string {
    return encrypt(token) || token;
}

/** Decrypt tokens from DB */
export function decryptToken(encrypted: string): string {
    return decrypt(encrypted) || encrypted;
}

export default {
    GTA_PROVIDERS,
    getProvider,
    getProvidersByType,
    getProvidersForRegion,
    buildAuthorizationUrl,
    exchangeCodeForTokens,
    refreshAccessToken,
    fetchUsageData,
    parseGreenButtonXml,
    parseUploadedGreenButtonFile,
    convertToBills,
    encryptToken,
    decryptToken,
};
