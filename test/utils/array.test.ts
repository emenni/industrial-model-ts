import { describe, expect, it } from "vitest";
import { chunks } from "../../src/utils/array";

describe("chunks", () => {
  it("returns an empty array for empty input", () => {
    expect(chunks([], 3)).toEqual([]);
  });

  it("keeps a single chunk when the input is smaller than the size", () => {
    expect(chunks([1, 2], 5)).toEqual([[1, 2]]);
  });

  it("keeps a single chunk when the input length equals the size", () => {
    expect(chunks([1, 2, 3], 3)).toEqual([[1, 2, 3]]);
  });

  it("splits into evenly sized chunks", () => {
    expect(chunks([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("leaves the remainder in a final smaller chunk", () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("preserves the original element order across chunks", () => {
    const input = Array.from({ length: 10 }, (_, index) => index);

    const result = chunks(input, 3);

    expect(result).toEqual([[0, 1, 2], [3, 4, 5], [6, 7, 8], [9]]);
    expect(result.flat()).toEqual(input);
  });

  it("does not mutate the input array", () => {
    const input = [1, 2, 3];

    chunks(input, 2);

    expect(input).toEqual([1, 2, 3]);
  });
});
