import { describe, expect, it } from "vitest";
import { parseTimeInput, shiftTime } from "./timeinput";

describe("campo de hora", () => {
  it.each([
    ["9", "09:00"], ["09", "09:00"], ["930", "09:30"], ["0930", "09:30"], ["9:30", "09:30"],
    ["9.30", "09:30"], ["21h", "21:00"], ["21:5", "21:50"], ["23:59", "23:59"], ["0", "00:00"],
  ])("%s → %s", (input, out) => expect(parseTimeInput(input)).toBe(out));

  it.each(["24", "12:60", "abc", "", "1:2:3"])("rechaza %s", (input) => expect(parseTimeInput(input)).toBeNull());

  it("sumar y restar minutos da la vuelta al día", () => {
    expect(shiftTime("23:45", 30)).toBe("00:15");
    expect(shiftTime("00:00", -15)).toBe("23:45");
  });
});
