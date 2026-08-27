import { describe, expectTypeOf, it } from "vitest";
import { type IndustrialModel, IndustrialModelClient, type NodeId } from "../src/index.js";
import type { AggregateOptions, AggregateResultItemForOptions } from "../src/types.js";
import {
  COGNITE_CORE_DATA_MODEL,
  makeCogniteClientMock,
  makeCogniteVolumeAggregateByTypeResponse,
} from "./fixtures/index.js";

type PointCloudVolume = IndustrialModel<{
  name: string;
  volume: number;
  volumeType: string;
}>;

type BaseEvent = IndustrialModel<{
  assets: NodeId[];
  duration: number;
  externalId: string;
}>;

describe("aggregate typing", () => {
  it("infers group and aggregate fields from options", async () => {
    const client = makeCogniteClientMock({
      aggregateResponse: makeCogniteVolumeAggregateByTypeResponse(),
    });
    const model = new IndustrialModelClient(client, COGNITE_CORE_DATA_MODEL);

    const { items } = await model.aggregate<PointCloudVolume>()({
      viewExternalId: "CognitePointCloudVolume",
      groupBy: { volumeType: true },
      aggregate: { avg: "volume" },
    });

    type Item = (typeof items)[number];

    expectTypeOf<Item["group"]>().toEqualTypeOf<{ volumeType: string } | undefined>();
    expectTypeOf<NonNullable<Item["aggregate"]>["property"]>().toEqualTypeOf<"volume">();
    expectTypeOf<NonNullable<Item["aggregate"]>["value"]>().toEqualTypeOf<number>();
    expectTypeOf<NonNullable<Item["aggregates"]>>().toEqualTypeOf<
      readonly [{ property: "volume"; value: number }]
    >();

    const first = items[0];
    if (first?.group) {
      first.group.volumeType;
      // @ts-expect-error name was not included in groupBy
      first.group.name;
    }
    if (first?.aggregate) {
      first.aggregate.property;
      first.aggregate.value;
    }
  });

  it("infers count without property when using {}", async () => {
    const client = makeCogniteClientMock();
    const model = new IndustrialModelClient(client, COGNITE_CORE_DATA_MODEL);

    const { items } = await model.aggregate<PointCloudVolume>()({
      viewExternalId: "CognitePointCloudVolume",
      aggregate: { count: {} },
    });

    type Aggregate = NonNullable<(typeof items)[number]["aggregate"]>;
    type HasProperty = "property" extends keyof Aggregate ? true : false;

    expectTypeOf<HasProperty>().toEqualTypeOf<false>();
  });

  it("allows list direct-relation groupBy and multi-aggregate in types", () => {
    const options = {
      viewExternalId: "BaseEvent",
      groupBy: { assets: true },
      aggregates: [{ count: "externalId" }, { sum: "duration" }],
    } as const satisfies AggregateOptions<BaseEvent>;

    type Item = AggregateResultItemForOptions<BaseEvent, typeof options>;

    expectTypeOf<NonNullable<Item["group"]>["assets"]>().toEqualTypeOf<NodeId>();
    expectTypeOf<NonNullable<Item["aggregate"]>>().toEqualTypeOf<{
      property: "externalId";
      value: number;
    }>();
    expectTypeOf<NonNullable<Item["aggregates"]>[0]>().toEqualTypeOf<{
      property: "externalId";
      value: number;
    }>();
    expectTypeOf<NonNullable<Item["aggregates"]>[1]>().toEqualTypeOf<{
      property: "duration";
      value: number;
    }>();

    // Prove groupBy accepts NodeId[] fields at the options layer
    expectTypeOf(options.groupBy).toEqualTypeOf<{ readonly assets: true }>();
  });
});
