# Evaluation receipt reference ownership (RT-49)

Each evaluate result owns independent prediction, ruleVersions and matches metadata. Reusing or updating caller options after return cannot rewrite a historical Evaluation. Mutating one returned record cannot change reusable options or sibling results. The async checkpoint API inherits this through the same evaluator.

Prediction copies its public flat fields, versions preserve ordered string values, and hits retain their existing construction/order/dedup semantics. Optional prediction remains undefined. Frozen caller values work; neither inputs nor outputs are frozen or mutated by Aegis. Public signatures and action classification are unchanged.

This is reference isolation, not signed or immutable receipt enforcement: explicitly editing a returned result is still possible. Hosts own authentic source/checkpoint truth, durable receipt persistence/signatures and exact desired-state execution. No proxy/getter, malformed extension-data, latency or action-atomicity claim. Novel exp59/Spec65 traces are recorded in SwarmLab; prior RT47/48 remain separate unlanded candidates.
