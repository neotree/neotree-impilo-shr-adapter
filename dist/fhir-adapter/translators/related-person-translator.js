"use strict";
/**
 * FHIR RelatedPerson Resource Translator
 * Transforms mother data to FHIR RelatedPerson resource
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RelatedPersonTranslator = void 0;
const config_1 = require("../../shared/config");
const logger_1 = require("../../shared/utils/logger");
const errors_1 = require("../../shared/utils/errors");
const logger = (0, logger_1.getLogger)('related-person-translator');
class RelatedPersonTranslator {
    constructor() {
        this.config = (0, config_1.getConfig)();
    }
    /**
     * Translate Neotree mother data to FHIR RelatedPerson resource
     */
    translate(data, patientReference) {
        if (!data.motherFirstName && !data.motherSurname) {
            logger.debug({ uid: data.uid }, 'No mother information available, skipping RelatedPerson');
            return null;
        }
        try {
            logger.debug({ uid: data.uid }, 'Translating mother data to FHIR RelatedPerson');
            const relatedPerson = {
                resourceType: 'RelatedPerson',
                meta: {
                    source: `${this.config.source.id}/${this.config.source.facilityId}`,
                },
                identifier: this.buildIdentifiers(data),
                active: true,
                patient: {
                    reference: patientReference,
                    display: this.buildBabyDisplay(data),
                },
                relationship: [this.buildMotherRelationship()],
                name: this.buildNames(data),
                gender: 'female',
            };
            logger.debug({ uid: data.uid }, 'RelatedPerson resource translated successfully');
            return relatedPerson;
        }
        catch (error) {
            logger.error({ error, uid: data.uid }, 'Failed to translate mother data');
            throw new errors_1.TransformationError('Failed to translate mother data to FHIR', {
                uid: data.uid,
                error: String(error),
            });
        }
    }
    /**
     * Build mother identifiers
     */
    buildIdentifiers(data) {
        const identifiers = [];
        // Mother identifier based on baby's UID
        identifiers.push({
            use: 'official',
            type: {
                coding: [
                    {
                        system: 'http://terminology.hl7.org/CodeSystem/v2-0203',
                        code: 'U',
                        display: 'Unspecified identifier',
                    },
                ],
                text: 'Mother Identifier',
            },
            system: `http://health.gov.zw/fhir/identifiers/${this.config.source.facilityId}/mother`,
            value: `mother-of-${data.uid}`,
        });
        return identifiers;
    }
    /**
     * Build mother relationship
     */
    buildMotherRelationship() {
        return {
            coding: [
                {
                    system: 'http://terminology.hl7.org/CodeSystem/v3-RoleCode',
                    code: 'MTH',
                    display: 'mother',
                },
            ],
            text: 'Mother',
        };
    }
    /**
     * Build mother names
     */
    buildNames(data) {
        const names = [];
        const name = {
            use: 'official',
        };
        if (data.motherSurname) {
            name.family = data.motherSurname;
        }
        if (data.motherFirstName) {
            name.given = [data.motherFirstName];
        }
        // Build text representation
        const nameParts = [];
        if (data.motherFirstName)
            nameParts.push(data.motherFirstName);
        if (data.motherSurname)
            nameParts.push(data.motherSurname);
        if (nameParts.length > 0) {
            name.text = nameParts.join(' ');
        }
        names.push(name);
        return names;
    }
    /**
     * Build baby display name for reference
     */
    buildBabyDisplay(data) {
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
exports.RelatedPersonTranslator = RelatedPersonTranslator;
//# sourceMappingURL=related-person-translator.js.map