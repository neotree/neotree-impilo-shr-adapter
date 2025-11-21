import { FHIRBundle, FHIRResource, FHIRPatient } from '../../shared/types/fhir.types';
export declare class BundleBuilder {
    static createTransactionBundle(patient: FHIRPatient): FHIRBundle;
    static createSearchSetBundle(resources: FHIRResource[]): FHIRBundle;
    static createCollectionBundle(resources: FHIRResource[]): FHIRBundle;
}
//# sourceMappingURL=bundle-builder.d.ts.map