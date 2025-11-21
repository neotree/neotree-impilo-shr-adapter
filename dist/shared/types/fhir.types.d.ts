/**
 * FHIR Resource Types
 * Simplified type definitions for FHIR R4 resources
 */
export interface FHIRResource {
    resourceType: string;
    id?: string;
    meta?: {
        versionId?: string;
        lastUpdated?: string;
        source?: string;
        profile?: string[];
        tag?: Coding[];
    };
    identifier?: Identifier[];
}
export interface Identifier {
    use?: 'usual' | 'official' | 'temp' | 'secondary' | 'old';
    type?: CodeableConcept;
    system?: string;
    value?: string;
    period?: Period;
    assigner?: Reference;
}
export interface CodeableConcept {
    coding?: Coding[];
    text?: string;
}
export interface Coding {
    system?: string;
    version?: string;
    code?: string;
    display?: string;
    userSelected?: boolean;
}
export interface Reference {
    reference?: string;
    type?: string;
    identifier?: Identifier;
    display?: string;
}
export interface Period {
    start?: string;
    end?: string;
}
export interface HumanName {
    use?: 'usual' | 'official' | 'temp' | 'nickname' | 'anonymous' | 'old' | 'maiden';
    text?: string;
    family?: string;
    given?: string[];
    prefix?: string[];
    suffix?: string[];
    period?: Period;
}
export interface ContactPoint {
    system?: 'phone' | 'fax' | 'email' | 'pager' | 'url' | 'sms' | 'other';
    value?: string;
    use?: 'home' | 'work' | 'temp' | 'old' | 'mobile';
    rank?: number;
    period?: Period;
}
export interface Address {
    use?: 'home' | 'work' | 'temp' | 'old' | 'billing';
    type?: 'postal' | 'physical' | 'both';
    text?: string;
    line?: string[];
    city?: string;
    district?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    period?: Period;
}
export interface FHIRPatient extends FHIRResource {
    resourceType: 'Patient';
    identifier?: Identifier[];
    active?: boolean;
    name?: HumanName[];
    telecom?: ContactPoint[];
    gender?: 'male' | 'female' | 'other' | 'unknown';
    birthDate?: string;
    deceasedBoolean?: boolean;
    deceasedDateTime?: string;
    address?: Address[];
    maritalStatus?: CodeableConcept;
    multipleBirthBoolean?: boolean;
    multipleBirthInteger?: number;
    contact?: PatientContact[];
    link?: PatientLink[];
    managingOrganization?: Reference;
}
export interface PatientContact {
    relationship?: CodeableConcept[];
    name?: HumanName;
    telecom?: ContactPoint[];
    address?: Address;
    gender?: 'male' | 'female' | 'other' | 'unknown';
    organization?: Reference;
    period?: Period;
}
export interface PatientLink {
    other: Reference;
    type: 'replaced-by' | 'replaces' | 'refer' | 'seealso';
}
export interface FHIRRelatedPerson extends FHIRResource {
    resourceType: 'RelatedPerson';
    identifier?: Identifier[];
    active?: boolean;
    patient: Reference;
    relationship?: CodeableConcept[];
    name?: HumanName[];
    telecom?: ContactPoint[];
    gender?: 'male' | 'female' | 'other' | 'unknown';
    birthDate?: string;
    address?: Address[];
    period?: Period;
}
export interface FHIREncounter extends FHIRResource {
    resourceType: 'Encounter';
    identifier?: Identifier[];
    status: 'planned' | 'arrived' | 'triaged' | 'in-progress' | 'onleave' | 'finished' | 'cancelled';
    class: Coding;
    type?: CodeableConcept[];
    subject?: Reference;
    participant?: EncounterParticipant[];
    period?: Period;
    reasonCode?: CodeableConcept[];
    diagnosis?: EncounterDiagnosis[];
    hospitalization?: EncounterHospitalization;
    location?: EncounterLocation[];
    serviceProvider?: Reference;
}
export interface EncounterParticipant {
    type?: CodeableConcept[];
    period?: Period;
    individual?: Reference;
}
export interface EncounterDiagnosis {
    condition: Reference;
    use?: CodeableConcept;
    rank?: number;
}
export interface EncounterHospitalization {
    preAdmissionIdentifier?: Identifier;
    origin?: Reference;
    admitSource?: CodeableConcept;
    reAdmission?: CodeableConcept;
    destination?: Reference;
    dischargeDisposition?: CodeableConcept;
}
export interface EncounterLocation {
    location: Reference;
    status?: 'planned' | 'active' | 'reserved' | 'completed';
    period?: Period;
}
export interface FHIRObservation extends FHIRResource {
    resourceType: 'Observation';
    identifier?: Identifier[];
    status: 'registered' | 'preliminary' | 'final' | 'amended' | 'corrected' | 'cancelled' | 'entered-in-error' | 'unknown';
    category?: CodeableConcept[];
    code: CodeableConcept;
    subject?: Reference;
    encounter?: Reference;
    effectiveDateTime?: string;
    effectivePeriod?: Period;
    issued?: string;
    performer?: Reference[];
    valueQuantity?: Quantity;
    valueCodeableConcept?: CodeableConcept;
    valueString?: string;
    valueBoolean?: boolean;
    valueInteger?: number;
    valueRange?: Range;
    interpretation?: CodeableConcept[];
    note?: Annotation[];
    bodySite?: CodeableConcept;
    method?: CodeableConcept;
    referenceRange?: ObservationReferenceRange[];
    component?: ObservationComponent[];
}
export interface Quantity {
    value?: number;
    comparator?: '<' | '<=' | '>=' | '>';
    unit?: string;
    system?: string;
    code?: string;
}
export interface Range {
    low?: Quantity;
    high?: Quantity;
}
export interface Annotation {
    authorReference?: Reference;
    authorString?: string;
    time?: string;
    text: string;
}
export interface ObservationReferenceRange {
    low?: Quantity;
    high?: Quantity;
    type?: CodeableConcept;
    appliesTo?: CodeableConcept[];
    age?: Range;
    text?: string;
}
export interface ObservationComponent {
    code: CodeableConcept;
    valueQuantity?: Quantity;
    valueCodeableConcept?: CodeableConcept;
    valueString?: string;
    interpretation?: CodeableConcept[];
    referenceRange?: ObservationReferenceRange[];
}
export interface FHIRCondition extends FHIRResource {
    resourceType: 'Condition';
    identifier?: Identifier[];
    clinicalStatus?: CodeableConcept;
    verificationStatus?: CodeableConcept;
    category?: CodeableConcept[];
    severity?: CodeableConcept;
    code?: CodeableConcept;
    bodySite?: CodeableConcept[];
    subject: Reference;
    encounter?: Reference;
    onsetDateTime?: string;
    onsetAge?: Quantity;
    onsetPeriod?: Period;
    abatementDateTime?: string;
    recordedDate?: string;
    recorder?: Reference;
    asserter?: Reference;
    note?: Annotation[];
}
export interface FHIRBundle extends FHIRResource {
    resourceType: 'Bundle';
    type: 'document' | 'message' | 'transaction' | 'transaction-response' | 'batch' | 'batch-response' | 'history' | 'searchset' | 'collection';
    timestamp?: string;
    total?: number;
    entry?: BundleEntry[];
}
export interface BundleEntry {
    fullUrl?: string;
    resource?: FHIRResource;
    request?: {
        method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
        url: string;
        ifNoneMatch?: string;
        ifModifiedSince?: string;
        ifMatch?: string;
        ifNoneExist?: string;
    };
    response?: {
        status: string;
        location?: string;
        etag?: string;
        lastModified?: string;
        outcome?: FHIRResource;
    };
}
//# sourceMappingURL=fhir.types.d.ts.map