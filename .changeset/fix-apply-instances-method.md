---
"industrial-model": patch
---

Fix `upsert`/`delete` calling a nonexistent `client.instances.apply` method on the Cognite SDK, which made every upsert and delete call throw at runtime. The adapter now calls the real `client.instances.upsert` and `client.instances.delete` methods (there is no combined upsert+delete endpoint in the SDK), splitting and merging requests as needed.
