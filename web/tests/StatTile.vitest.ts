// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { describe, expect, test } from "vitest";

import StatTile from "@/ui/StatTile.vue";

describe("StatTile", () => {
  test("renders catalog label, value, and delta", () => {
    const wrapper = mount(StatTile, {
      props: {
        metricKey: "dashboard.runs",
        value: 12,
        previous: 9,
        compareLabel: "vs 24 hours ago",
      },
    });
    expect(wrapper.find(".stat-tile__header").exists()).toBe(true);
    expect(wrapper.find(".stat-tile__header .stat-tile__icon").exists()).toBe(true);
    expect(wrapper.find(".stat-tile__header .stat-tile__label").text()).toBe("Runs");
    expect(wrapper.find(".stat-tile__value").text()).toBe("12");
    expect(wrapper.text()).toContain("+3");
    expect(wrapper.attributes("aria-label")).toContain("Runs: 12");
    wrapper.unmount();
  });

  test("shows attention flag for attention metrics with positive value", () => {
    const wrapper = mount(StatTile, {
      props: {
        metricKey: "work.needsAttention",
        value: 2,
        previous: 1,
      },
    });
    expect(wrapper.find(".stat-tile__flag").exists()).toBe(true);
    wrapper.unmount();
  });

  test("links via RouterLink when to is set", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/projects", name: "projects", component: { template: "<div />" } }],
    });
    await router.push("/projects");
    await router.isReady();
    const wrapper = mount(StatTile, {
      props: {
        metricKey: "impact.prsOpen",
        value: 3,
        to: { name: "projects" },
      },
      global: { plugins: [router] },
    });
    expect(wrapper.find("a").exists()).toBe(true);
    wrapper.unmount();
  });

  test("hides delta when previous is null", () => {
    const wrapper = mount(StatTile, {
      props: {
        metricKey: "dashboard.projects",
        value: 4,
        previous: null,
      },
    });
    expect(wrapper.find(".metric-delta").exists()).toBe(false);
    wrapper.unmount();
  });
});
