"use strict";
/**
 * FHIR Patient Resource Translator
 * Transforms Neotree patient data to FHIR Patient resource
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PatientTranslator = void 0;
const config_1 = require("../../shared/config");
const errors_1 = require("../../shared/utils/errors");
class PatientTranslator {
    constructor() {
        this.config = (0, config_1.getConfig)();
    }
    translate(data) {
        try {
            const patient = {
                resourceType: 'Patient',
                meta: {
                    tag: [
                        {
                            system: 'http://openclientregistry.org/fhir/clientid',
                            code: this.config.source.facilityId,
                        },
                    ],
                },
                identifier: this.buildIdentifiers(data),
                name: this.buildNames(data),
                gender: data.gender || 'unknown',
                birthDate: this.extractDate(data.dateOfBirth),
                managingOrganization: {
                    reference: `Organization/${this.config.source.facilityId}`,
                },
            };
            if (!patient.birthDate) {
                delete patient.birthDate;
            }
            return patient;
        }
        catch (error) {
            throw new errors_1.TransformationError('Translation failed', {
                uid: data.uid,
                error: String(error),
            });
        }
    }
    /**
     * Build patient identifiers
     */
    buildIdentifiers(data) {
        const identifiers = [];
        // Primary identifier: Neotree Patient ID
        identifiers.push({
            system: 'urn:neotree:impilo-id',
            value: data.uid,
        });
        // Secondary identifier: Impilo UID (UUID)
        if (data.impilo_uid) {
            identifiers.push({
                system: 'urn:impilo:uid',
                value: data.impilo_uid,
            });
        }
        return identifiers;
    }
    /**
     * Build patient names
     */
    buildNames(data) {
        const names = [];
        if (data.babyFirstName || data.babyLastName) {
            const name = {
                use: 'official',
            };
            if (data.babyLastName) {
                name.family = data.babyLastName;
            }
            if (data.babyFirstName) {
                name.given = [data.babyFirstName];
            }
            names.push(name);
        }
        // If no name is available, create a temporary name with baby of mother
        if (names.length === 0 && data.motherFirstName) {
            names.push({
                use: 'temp',
                family: data.motherFirstName,
            });
        }
        // If still no name, use UID as fallback (required by FHIR - cannot have empty array)
        if (names.length === 0) {
            names.push({
                use: 'temp',
                family: data.uid,
            });
        }
        return names;
    }
    extractDate(isoString) {
        if (!isoString)
            return undefined;
        try {
            const date = new Date(isoString);
            return date.toISOString().split('T')[0];
        }
        catch {
            return undefined;
        }
    }
}
exports.PatientTranslator = PatientTranslator;
//# sourceMappingURL=patient-translator.js.map