"use strict";
/**
 * FHIR Encounter Resource Translator
 * Transforms Neotree admission/discharge data to FHIR Encounter resource
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EncounterTranslator = void 0;
const config_1 = require("../../shared/config");
const logger_1 = require("../../shared/utils/logger");
const errors_1 = require("../../shared/utils/errors");
const logger = (0, logger_1.getLogger)('encounter-translator');
class EncounterTranslator {
    constructor() {
        this.config = (0, config_1.getConfig)();
    }
    /**
     * Translate Neotree data to FHIR Encounter resource
     */
    translate(data, patientReference) {
        try {
            logger.debug({ uid: data.uid }, 'Translating encounter data to FHIR');
            const encounter = {
                resourceType: 'Encounter',
                meta: {
                    source: `${this.config.source.id}/${this.config.source.facilityId}`,
                },
                identifier: this.buildIdentifiers(data),
                status: this.determineStatus(data),
                class: this.buildEncounterClass(),
                type: this.buildEncounterType(data),
                subject: {
                    reference: patientReference,
                    display: this.buildPatientDisplay(data),
                },
                period: this.buildPeriod(data),
                reasonCode: this.buildReasonCodes(data),
                serviceProvider: this.buildServiceProvider(),
            };
            logger.debug({ uid: data.uid }, 'Encounter resource translated successfully');
            return encounter;
        }
        catch (error) {
            logger.error({ error, uid: data.uid }, 'Failed to translate encounter data');
            throw new errors_1.TransformationError('Failed to translate encounter data to FHIR', {
                uid: data.uid,
                error: String(error),
            });
        }
    }
    /**
     * Build encounter identifiers
     */
    buildIdentifiers(data) {
        return [
            {
                use: 'official',
                system: `urn:oid:${this.config.source.facilityId}:neotree:encounter`,
                value: `encounter-${data.uniqueKey}`,
            },
        ];
    }
    /**
     * Determine encounter status
     */
    determineStatus(data) {
        if (data.dischargeDateTime) {
            return 'finished';
        }
        if (data.admissionDateTime) {
            return 'in-progress';
        }
        return 'planned';
    }
    /**
     * Build encounter class (inpatient for neonatal admissions)
     */
    buildEncounterClass() {
        return {
            system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
            code: 'IMP',
            display: 'inpatient encounter',
        };
    }
    /**
     * Build encounter type
     */
    buildEncounterType(_data) {
        const types = [];
        // Neonatal encounter
        types.push({
            coding: [
                {
                    system: 'http://snomed.info/sct',
                    code: '424441002',
                    display: 'Neonatal encounter',
                },
            ],
            text: 'Neonatal Admission',
        });
        return types;
    }
    /**
     * Build encounter period
     */
    buildPeriod(data) {
        if (!data.admissionDateTime && !data.dischargeDateTime) {
            return undefined;
        }
        const period = {};
        if (data.admissionDateTime) {
            period.start = new Date(data.admissionDateTime).toISOString();
        }
        if (data.dischargeDateTime) {
            period.end = new Date(data.dischargeDateTime).toISOString();
        }
        return period;
    }
    /**
     * Build reason codes (admission reason)
     */
    buildReasonCodes(data) {
        if (!data.admissionReason && data.diagnoses.length === 0) {
            return undefined;
        }
        const reasons = [];
        if (data.admissionReason) {
            reasons.push({
                text: data.admissionReason,
            });
        }
        return reasons.length > 0 ? reasons : undefined;
    }
    /**
     * Build service provider reference
     */
    buildServiceProvider() {
        return {
            reference: `Organization/${this.config.source.facilityId}`,
            display: this.config.source.facilityName,
        };
    }
    /**
     * Build patient display name
     */
    buildPatientDisplay(data) {
        const nameParts = [];
        if (data.babyFirstName)
            nameParts.push(data.babyFirstName);
        if (data.babyLastName)
            nameParts.push(data.babyLastName);
        if (nameParts.length > 0) {
            return nameParts.join(' ');
        }
        return `Patient ${data.uid}`;
    }
}
exports.EncounterTranslator = EncounterTranslator;
//# sourceMappingURL=encounter-translator.js.map