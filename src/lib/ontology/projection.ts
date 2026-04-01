export async function projectOntologyToGraph() {
  return {
    projected: false,
    reason: "Ontology projection is deferred in v1. Postgres remains canonical.",
  };
}