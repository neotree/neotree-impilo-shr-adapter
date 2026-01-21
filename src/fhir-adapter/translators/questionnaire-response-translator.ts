/**
 * FHIR QuestionnaireResponse Translator
 * Transforms complete Neotree form submission to FHIR QuestionnaireResponse resource
 * Captures the entire clinical assessment as a structured, queryable resource
 */

import type {
  FHIRQuestionnaireResponse,
  QuestionnaireResponseItem,
  QuestionnaireResponseAnswer,
  Reference,
} from '../../shared/types/fhir.types';
import { NeotreePatientData, NeotreeEntry } from '../../shared/types/neotree.types';
import { getConfig } from '../../shared/config';
import { getLogger } from '../../shared/utils/logger';
import { TransformationError } from '../../shared/utils/errors';
import { getMappingConfigurationService } from '../services/mapping-configuration-service';

const logger = getLogger('questionnaire-response-translator');

export class QuestionnaireResponseTranslator {
  private config = getConfig();
  private mappingService = getMappingConfigurationService();

  /**
   * Translate complete Neotree entry to FHIR QuestionnaireResponse
   * Captures all form responses for comprehensive audit trail and clinical documentation
   */
  translate(
    data: NeotreePatientData,
    patientReference: string,
    encounterReference?: string,
    neotreeEntry?: NeotreeEntry
  ): FHIRQuestionnaireResponse {
    try {
      logger.debug({ uid: data.uid }, 'Translating form submission to QuestionnaireResponse');

      const resolvedFacilityId = data.facilityId;
      const questionnaireReference = this.getQuestionnaireReference(data, resolvedFacilityId);
      const response: FHIRQuestionnaireResponse = {
        resourceType: 'QuestionnaireResponse',
        meta: {
          source: resolvedFacilityId
            ? `${this.config.source.id}/${resolvedFacilityId}`
            : this.config.source.id,
        },
        identifier: [
          {
            use: 'official',
            system: resolvedFacilityId
              ? `urn:oid:${resolvedFacilityId}:neotree:questionnaire-response`
              : undefined,
            value: `qr-${data.uniqueKey}`,
          },
        ],
        status: 'completed',
        subject: {
          reference: patientReference,
          // SHR should NOT include display name - only reference to CR patient
          // Patient identifying information stays in CR only
        },
        encounter: encounterReference
          ? {
              reference: encounterReference,
            }
          : undefined,
        authored: data.completedAt ? new Date(data.completedAt).toISOString() : new Date().toISOString(),
        item: this.buildQuestionnaireItems(data, neotreeEntry),
      };
      if (questionnaireReference) {
        response.questionnaire = questionnaireReference;
      }

      logger.debug({ uid: data.uid }, 'QuestionnaireResponse translated successfully');
      return response;
    } catch (error) {
      logger.error({ error, uid: data.uid }, 'Failed to translate questionnaire response');
      throw new TransformationError('Failed to translate form submission to FHIR', {
        uid: data.uid,
        error: String(error),
      });
    }
  }

  /**
   * Get questionnaire reference based on script type and facility
   */
  private getQuestionnaireReference(data: NeotreePatientData, facilityId?: string): string | undefined {
    const questionnaireConfig = this.mappingService.getQuestionnaireConfig(facilityId);
    if (questionnaireConfig?.url) {
      return questionnaireConfig.url;
    }
    if (questionnaireConfig?.id) {
      return `Questionnaire/${questionnaireConfig.id}`;
    }
    if (data.scriptType && data.facilityId) {
      return `${data.scriptType}-${data.facilityId}-${data.scriptType}`.toLowerCase();
    }
    return undefined;
  }

  /**
   * Build questionnaire response items from patient data
   * Organizes all form fields into a hierarchical structure
   */
  private buildQuestionnaireItems(data: NeotreePatientData, neotreeEntry?: NeotreeEntry): QuestionnaireResponseItem[] {
    const items: QuestionnaireResponseItem[] = [];

    // Demographics section
    items.push(this.buildDemographicsSection(data));

    // Vital signs section
    items.push(this.buildVitalSignsSection(data));

    // Examination section
    items.push(this.buildExaminationSection(data));

    // Maternal information section (critical for PMTCT)
    items.push(this.buildMaternalInformationSection(data));

    // Labour and delivery section
    items.push(this.buildLabourAndDeliverySection(data));

    // Clinical assessment section
    items.push(this.buildClinicalAssessmentSection(data));

    // Raw form entries (if available)
    if (neotreeEntry?.entries) {
      items.push(this.buildRawEntriesSection(neotreeEntry.entries));
    }

    logger.debug({ uid: data.uid, itemCount: items.length }, 'Built questionnaire items');
    return items;
  }

  /**
   * Build demographics section
   */
  private buildDemographicsSection(data: NeotreePatientData): QuestionnaireResponseItem {
    const answers: QuestionnaireResponseItem[] = [];

    if (data.babyFirstName) {
      answers.push(this.createTextItem('first-name', 'Baby First Name', data.babyFirstName));
    }
    if (data.babyLastName) {
      answers.push(this.createTextItem('last-name', 'Baby Last Name', data.babyLastName));
    }
    if (data.gender) {
      answers.push(this.createTextItem('gender', 'Gender', data.gender));
    }
    if (data.dateOfBirth) {
      answers.push(this.createTextItem('date-of-birth', 'Date of Birth', data.dateOfBirth));
    }
    if (data.timeOfBirth) {
      answers.push(this.createTextItem('time-of-birth', 'Time of Birth', data.timeOfBirth));
    }
    if (data.gestation !== undefined) {
      answers.push(this.createDecimalItem('gestation-weeks', 'Gestational Age (weeks)', data.gestation));
    }

    return {
      linkId: 'demographics',
      text: 'Baby Demographics',
      item: answers,
    };
  }

  /**
   * Build vital signs section
   */
  private buildVitalSignsSection(data: NeotreePatientData): QuestionnaireResponseItem {
    const answers: QuestionnaireResponseItem[] = [];

    if (data.birthWeight !== undefined) {
      answers.push(this.createDecimalItem('birth-weight', 'Birth Weight (g)', data.birthWeight));
    }
    if (data.admissionWeight !== undefined) {
      answers.push(this.createDecimalItem('admission-weight', 'Admission Weight (g)', data.admissionWeight));
    }
    if (data.length !== undefined) {
      answers.push(this.createDecimalItem('length', 'Length (cm)', data.length));
    }
    if (data.ofc !== undefined) {
      answers.push(this.createDecimalItem('ofc', 'Occipital Frontal Circumference (cm)', data.ofc));
    }
    if (data.heartRate !== undefined) {
      answers.push(this.createDecimalItem('heart-rate', 'Heart Rate (bpm)', data.heartRate));
    }
    if (data.respiratoryRate !== undefined) {
      answers.push(this.createDecimalItem('respiratory-rate', 'Respiratory Rate (breaths/min)', data.respiratoryRate));
    }
    if (data.temperature !== undefined) {
      answers.push(this.createDecimalItem('temperature', 'Temperature (°C)', data.temperature));
    }
    if (data.saturation !== undefined) {
      answers.push(this.createDecimalItem('saturation', 'Oxygen Saturation (%)', data.saturation));
    }
    if (data.bloodSugarMmol !== undefined) {
      answers.push(this.createDecimalItem('blood-sugar-mmol', 'Blood Sugar (mmol/L)', data.bloodSugarMmol));
    }
    if (data.bloodSugarMg !== undefined) {
      answers.push(this.createDecimalItem('blood-sugar-mg', 'Blood Sugar (mg/dL)', data.bloodSugarMg));
    }

    return {
      linkId: 'vital-signs',
      text: 'Vital Signs',
      item: answers,
    };
  }

  /**
   * Build examination section
   */
  private buildExaminationSection(data: NeotreePatientData): QuestionnaireResponseItem {
    const answers: QuestionnaireResponseItem[] = [];

    // Apgar scores
    if (data.apgar1 !== undefined) {
      answers.push(this.createDecimalItem('apgar-1', 'Apgar Score at 1 minute', data.apgar1));
    }
    if (data.apgar5 !== undefined) {
      answers.push(this.createDecimalItem('apgar-5', 'Apgar Score at 5 minutes', data.apgar5));
    }
    if (data.apgar10 !== undefined) {
      answers.push(this.createDecimalItem('apgar-10', 'Apgar Score at 10 minutes', data.apgar10));
    }

    // General examination
    if (data.suckReflex) {
      answers.push(this.createTextItem('suck-reflex', 'Suck Reflex', data.suckReflex));
    }
    if (data.palate) {
      answers.push(this.createTextItem('palate', 'Palate Examination', data.palate));
    }
    if (data.headShape) {
      answers.push(this.createTextItem('head-shape', 'Head Shape', data.headShape));
    }
    if (data.dysmorphic !== undefined) {
      answers.push(this.createBooleanItem('dysmorphic-features', 'Dysmorphic Features', data.dysmorphic));
    }
    if (data.tone) {
      answers.push(this.createTextItem('muscle-tone', 'Muscle Tone', data.tone));
    }
    if (data.spine) {
      answers.push(this.createTextItem('spine', 'Spine Condition', data.spine));
    }
    if (data.activity) {
      answers.push(this.createTextItem('activity', 'Activity Level', data.activity));
    }
    if (data.fontanelle) {
      answers.push(this.createTextItem('fontanelle', 'Fontanelle State', data.fontanelle));
    }

    // Respiratory findings
    if (data.signsRD && data.signsRD.length > 0) {
      answers.push(this.createTextItem('respiratory-distress', 'Respiratory Distress Signs', data.signsRD.join('; ')));
    }
    if (data.wob) {
      answers.push(this.createTextItem('work-of-breathing', 'Work of Breathing', data.wob));
    }
    if (data.chestAusc && data.chestAusc.length > 0) {
      answers.push(this.createTextItem('chest-auscultation', 'Chest Auscultation', data.chestAusc.join('; ')));
    }
    if (data.colour) {
      answers.push(this.createTextItem('skin-color', 'Skin Color', data.colour));
    }

    // Circulatory findings
    if (data.crt) {
      answers.push(this.createTextItem('capillary-refill', 'Capillary Refill Time', data.crt));
    }

    // Abdominal findings
    if (data.signsDehydrations && data.signsDehydrations.length > 0) {
      answers.push(this.createTextItem('dehydration-signs', 'Dehydration Signs', data.signsDehydrations.join('; ')));
    }
    if (data.abdomen && data.abdomen.length > 0) {
      answers.push(this.createTextItem('abdominal-examination', 'Abdominal Examination', data.abdomen.join('; ')));
    }
    if (data.umbilicus && data.umbilicus.length > 0) {
      answers.push(this.createTextItem('umbilicus-condition', 'Umbilicus Condition', data.umbilicus.join('; ')));
    }
    if (data.genitalia) {
      answers.push(this.createTextItem('genitalia', 'Genitalia', data.genitalia));
    }
    if (data.anus !== undefined) {
      answers.push(this.createBooleanItem('anus-patent', 'Anus Patent', data.anus));
    }

    // Musculoskeletal and skin
    if (data.mskProblems && data.mskProblems.length > 0) {
      answers.push(this.createTextItem('msk-problems', 'Musculoskeletal Problems', data.mskProblems.join('; ')));
    }
    if (data.jaundice) {
      answers.push(this.createTextItem('jaundice', 'Jaundice Assessment', data.jaundice));
    }
    if (data.skin && data.skin.length > 0) {
      answers.push(this.createTextItem('skin-examination', 'Skin Examination', data.skin.join('; ')));
    }

    // Resuscitation
    if (data.cryBirth !== undefined) {
      answers.push(this.createBooleanItem('cry-at-birth', 'Cried at Birth', data.cryBirth));
    }
    if (data.resuscitation && data.resuscitation.length > 0) {
      answers.push(this.createTextItem('resuscitation', 'Resuscitation Methods', data.resuscitation.join('; ')));
    }

    return {
      linkId: 'physical-examination',
      text: 'Physical Examination',
      item: answers,
    };
  }

  /**
   * Build maternal information section (critical for PMTCT)
   */
  private buildMaternalInformationSection(data: NeotreePatientData): QuestionnaireResponseItem {
    const answers: QuestionnaireResponseItem[] = [];

    if (data.motherFirstName) {
      answers.push(this.createTextItem('mother-first-name', 'Mother First Name', data.motherFirstName));
    }
    if (data.motherSurname) {
      answers.push(this.createTextItem('mother-surname', 'Mother Surname', data.motherSurname));
    }
    if (data.motherDOB) {
      answers.push(this.createTextItem('mother-dob', 'Mother Date of Birth', data.motherDOB));
    }
    if (data.motherAgeYears !== undefined) {
      answers.push(this.createDecimalItem('mother-age', 'Mother Age (years)', data.motherAgeYears));
    }
    if (data.maritalStatus) {
      answers.push(this.createTextItem('marital-status', 'Marital Status', data.maritalStatus));
    }

    // HIV Status - CRITICAL for PMTCT
    if (data.motherHIVStatus) {
      answers.push(this.createTextItem('mother-hiv-status', 'Maternal HIV Status', data.motherHIVStatus));
    }
    if (data.motherHIVTest !== undefined) {
      answers.push(this.createBooleanItem('mother-hiv-test', 'Maternal HIV Test Done', data.motherHIVTest));
    }
    if (data.motherHIVTestDate) {
      answers.push(this.createTextItem('mother-hiv-test-date', 'HIV Test Date', data.motherHIVTestDate));
    }
    if (data.haart !== undefined) {
      answers.push(this.createBooleanItem('haart-therapy', 'On HAART', data.haart));
    }
    if (data.maternalViralLoad !== undefined) {
      answers.push(this.createDecimalItem('maternal-viral-load', 'Maternal Viral Load (copies/mL)', data.maternalViralLoad));
    }
    if (data.nvpGiven !== undefined) {
      answers.push(this.createBooleanItem('nvp-given', 'NVP Given to Baby', data.nvpGiven));
    }

    // Syphilis
    if (data.syphilisResult) {
      answers.push(this.createTextItem('syphilis-result', 'Syphilis Test Result', data.syphilisResult));
    }
    if (data.syphilisTestDate) {
      answers.push(this.createTextItem('syphilis-test-date', 'Syphilis Test Date', data.syphilisTestDate));
    }

    // Antenatal care
    if (data.antenatalCareVisits !== undefined) {
      answers.push(this.createDecimalItem('anc-visits', 'ANC Visits', data.antenatalCareVisits));
    }
    if (data.tetanusToxoidVaccine !== undefined) {
      answers.push(this.createBooleanItem('tetanus-vaccine', 'Tetanus Toxoid Vaccine', data.tetanusToxoidVaccine));
    }
    if (data.ironSupplementation !== undefined) {
      answers.push(this.createBooleanItem('iron-supplementation', 'Iron Supplementation', data.ironSupplementation));
    }
    if (data.folateSupplementation !== undefined) {
      answers.push(this.createBooleanItem('folate-supplementation', 'Folate Supplementation', data.folateSupplementation));
    }
    if (data.antenatalSteroids !== undefined) {
      answers.push(this.createBooleanItem('antenatal-steroids', 'Antenatal Steroids', data.antenatalSteroids));
    }
    if (data.pregnancyConditions && data.pregnancyConditions.length > 0) {
      answers.push(this.createTextItem('pregnancy-conditions', 'Pregnancy Conditions', data.pregnancyConditions.join('; ')));
    }

    return {
      linkId: 'maternal-information',
      text: 'Maternal Information (PMTCT Critical)',
      item: answers,
    };
  }

  /**
   * Build labour and delivery section
   */
  private buildLabourAndDeliverySection(data: NeotreePatientData): QuestionnaireResponseItem {
    const answers: QuestionnaireResponseItem[] = [];

    if (data.labourDuration !== undefined) {
      answers.push(this.createDecimalItem('labour-duration', 'Labour Duration (hours)', data.labourDuration));
    }
    if (data.modeOfDelivery) {
      answers.push(this.createTextItem('mode-of-delivery', 'Mode of Delivery', data.modeOfDelivery));
    }
    if (data.romLength) {
      answers.push(this.createTextItem('rom-length', 'Rupture of Membranes Duration', data.romLength));
    }
    if (data.labourProblems && data.labourProblems.length > 0) {
      answers.push(this.createTextItem('labour-problems', 'Labour Problems', data.labourProblems.join('; ')));
    }
    if (data.maternalSepsisRiskFactors && data.maternalSepsisRiskFactors.length > 0) {
      answers.push(
        this.createTextItem('maternal-sepsis-risk', 'Maternal Sepsis Risk Factors', data.maternalSepsisRiskFactors.join('; '))
      );
    }

    return {
      linkId: 'labour-delivery',
      text: 'Labour and Delivery',
      item: answers,
    };
  }

  /**
   * Build clinical assessment section
   */
  private buildClinicalAssessmentSection(data: NeotreePatientData): QuestionnaireResponseItem {
    const answers: QuestionnaireResponseItem[] = [];

    if (data.admissionReason) {
      answers.push(this.createTextItem('admission-reason', 'Admission Reason', data.admissionReason));
    }
    if (data.admissionDateTime) {
      answers.push(this.createTextItem('admission-date-time', 'Admission DateTime', data.admissionDateTime));
    }
    if (data.dischargeDateTime) {
      answers.push(this.createTextItem('discharge-date-time', 'Discharge DateTime', data.dischargeDateTime));
    }
    if (data.diagnoses && data.diagnoses.length > 0) {
      answers.push(this.createTextItem('diagnoses', 'Diagnoses', data.diagnoses.join('; ')));
    }

    return {
      linkId: 'clinical-assessment',
      text: 'Clinical Assessment',
      item: answers,
    };
  }

  /**
   * Build raw form entries section (for audit trail)
   */
  private buildRawEntriesSection(entries: Record<string, any>): QuestionnaireResponseItem {
    const answers: QuestionnaireResponseItem[] = [];

    for (const [key, entry] of Object.entries(entries)) {
      if (entry && typeof entry === 'object' && 'values' in entry) {
        const values = entry.values;
        if (values.value && Array.isArray(values.value)) {
          const value = values.value.length === 1 ? values.value[0] : values.value.join('; ');
          answers.push(this.createTextItem(key, key, String(value)));
        }
      }
    }

    return {
      linkId: 'raw-form-entries',
      text: 'Raw Form Entries (Audit Trail)',
      item: answers,
    };
  }

  /**
   * Helper method: create a text item
   */
  private createTextItem(linkId: string, text: string, value: string): QuestionnaireResponseItem {
    return {
      linkId,
      text,
      answer: [
        {
          valueString: value,
        },
      ],
    };
  }

  /**
   * Helper method: create a boolean item
   */
  private createBooleanItem(linkId: string, text: string, value: boolean): QuestionnaireResponseItem {
    return {
      linkId,
      text,
      answer: [
        {
          valueBoolean: value,
        },
      ],
    };
  }

  /**
   * Helper method: create a decimal item
   */
  private createDecimalItem(linkId: string, text: string, value: number): QuestionnaireResponseItem {
    return {
      linkId,
      text,
      answer: [
        {
          valueDecimal: value,
        },
      ],
    };
  }

}
