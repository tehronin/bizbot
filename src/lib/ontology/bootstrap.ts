import { ONTOLOGY_BOOTSTRAP_VOCABULARY } from "@/lib/ontology/constants";

export async function seedOntologyBootstrap() {
  return {
    attempted: false,
    seeded: 0,
    vocabulary: ONTOLOGY_BOOTSTRAP_VOCABULARY,
    note: "Ontology v1 keeps bootstrap optional and deferred to explicit maintenance flows.",
  };
}