/**
 * Glass Box - Hardcoded Sample Data
 * Realistic workspace data for hackathon demo
 */

const GlassBoxData = {
  // Workspace info
  workspace: {
    name: "Product Launch Q1 2025",
    description: "Complete product launch execution",
  },

  // All nodes
  nodes: {
    "gb-001": {
      id: "gb-001",
      name: "Launch Marketing Campaign",
      author: { name: "Sarah Chen", initials: "SC" },
      goal: "Execute comprehensive Q1 marketing campaign across all digital channels to drive awareness and generate leads for the new product launch.",
      result:
        "Campaign live with 12% CTR improvement over baseline. Generated 2,400 qualified leads in first week.",
      status: "complete",
      evidence: [
        {
          id: "ev-001",
          type: "note",
          content:
            "Kickoff meeting completed - aligned on KPIs: 10% CTR target, 2000 leads goal",
          timestamp: "2025-01-10T09:30:00Z",
        },
        {
          id: "ev-002",
          type: "file",
          name: "campaign-brief-v3.pdf",
          size: "2.4 MB",
          timestamp: "2025-01-10T14:22:00Z",
        },
        {
          id: "ev-003",
          type: "link",
          url: "https://figma.com/file/abc123",
          title: "Ad Creative Designs - Final",
          timestamp: "2025-01-12T11:00:00Z",
        },
        {
          id: "ev-004",
          type: "note",
          content: "A/B test results: Variant B outperforming by 18%",
          timestamp: "2025-01-14T16:45:00Z",
        },
        {
          id: "ev-005",
          type: "reference",
          nodeId: "gb-005",
          nodeName: "Create Social Media Content",
          timestamp: "2025-01-15T10:00:00Z",
        },
        {
          id: "ev-006",
          type: "note",
          content: "Campaign launched successfully across all channels",
          timestamp: "2025-01-17T08:00:00Z",
        },
      ],
      children: ["gb-002", "gb-003"],
      parent: null,
    },

    "gb-002": {
      id: "gb-002",
      name: "Design Ad Creatives",
      author: { name: "Alex Kim", initials: "AK" },
      goal: "Create visually compelling ad creatives for social media, display, and email campaigns.",
      result:
        "12 ad variations delivered. Hero banner achieving 15% higher engagement.",
      status: "complete",
      evidence: [
        {
          id: "ev-010",
          type: "note",
          content: "Reviewed brand guidelines and competitor analysis",
          timestamp: "2025-01-11T10:00:00Z",
        },
        {
          id: "ev-011",
          type: "file",
          name: "mood-board.fig",
          size: "8.1 MB",
          timestamp: "2025-01-11T14:30:00Z",
        },
        {
          id: "ev-012",
          type: "link",
          url: "https://figma.com/file/designs",
          title: "Ad Creatives - v1 Drafts",
          timestamp: "2025-01-12T09:00:00Z",
        },
        {
          id: "ev-013",
          type: "note",
          content: "Feedback incorporated: increased contrast, simplified CTAs",
          timestamp: "2025-01-13T11:20:00Z",
        },
      ],
      children: [],
      parent: "gb-001",
    },

    "gb-003": {
      id: "gb-003",
      name: "Set Up Analytics Tracking",
      author: { name: "Jordan Lee", initials: "JL" },
      goal: "Implement comprehensive tracking for all campaign touchpoints to measure performance.",
      result:
        "UTM parameters and conversion tracking live across all channels.",
      status: "complete",
      evidence: [
        {
          id: "ev-020",
          type: "note",
          content: "Defined tracking requirements with marketing team",
          timestamp: "2025-01-11T15:00:00Z",
        },
        {
          id: "ev-021",
          type: "file",
          name: "UTM-matrix.xlsx",
          size: "156 KB",
          timestamp: "2025-01-12T10:45:00Z",
        },
        {
          id: "ev-022",
          type: "link",
          url: "https://analytics.google.com/dashboard/abc",
          title: "Campaign Dashboard",
          timestamp: "2025-01-13T14:00:00Z",
        },
      ],
      children: [],
      parent: "gb-001",
    },

    "gb-004": {
      id: "gb-004",
      name: "Product Development Sprint",
      author: { name: "Mike Torres", initials: "MT" },
      goal: "Complete core feature development for v2.0 release including new dashboard and API improvements.",
      result: null,
      status: "in-progress",
      evidence: [
        {
          id: "ev-030",
          type: "note",
          content: "Sprint planning complete. 24 story points committed.",
          timestamp: "2025-01-08T10:00:00Z",
        },
        {
          id: "ev-031",
          type: "link",
          url: "https://linear.app/team/sprint-42",
          title: "Sprint 42 Board",
          timestamp: "2025-01-08T10:30:00Z",
        },
        {
          id: "ev-032",
          type: "file",
          name: "technical-spec-v2.md",
          size: "45 KB",
          timestamp: "2025-01-09T14:00:00Z",
        },
        {
          id: "ev-033",
          type: "note",
          content: "Dashboard component 80% complete. Blocked on API endpoint.",
          timestamp: "2025-01-15T17:30:00Z",
        },
        {
          id: "ev-034",
          type: "reference",
          nodeId: "gb-006",
          nodeName: "API Optimization",
          timestamp: "2025-01-16T09:00:00Z",
        },
      ],
      children: ["gb-006", "gb-007"],
      parent: null,
    },

    "gb-005": {
      id: "gb-005",
      name: "Create Social Media Content",
      author: { name: "Emma Wilson", initials: "EW" },
      goal: "Develop and schedule social media content calendar for launch week.",
      result: "28 posts scheduled across LinkedIn, Twitter, and Instagram.",
      status: "complete",
      evidence: [
        {
          id: "ev-040",
          type: "note",
          content:
            "Content themes defined: innovation, customer stories, behind-the-scenes",
          timestamp: "2025-01-09T11:00:00Z",
        },
        {
          id: "ev-041",
          type: "file",
          name: "content-calendar-jan.xlsx",
          size: "89 KB",
          timestamp: "2025-01-10T16:00:00Z",
        },
        {
          id: "ev-042",
          type: "link",
          url: "https://buffer.com/publish/calendar",
          title: "Buffer Schedule",
          timestamp: "2025-01-14T12:00:00Z",
        },
      ],
      children: [],
      parent: null,
    },

    "gb-006": {
      id: "gb-006",
      name: "API Optimization",
      author: { name: "David Park", initials: "DP" },
      goal: "Optimize API response times and implement caching layer for high-traffic endpoints.",
      result: null,
      status: "in-progress",
      evidence: [
        {
          id: "ev-050",
          type: "note",
          content: "Profiled current endpoints. Identified 3 bottlenecks.",
          timestamp: "2025-01-14T10:00:00Z",
        },
        {
          id: "ev-051",
          type: "file",
          name: "performance-report.pdf",
          size: "1.2 MB",
          timestamp: "2025-01-14T15:00:00Z",
        },
        {
          id: "ev-052",
          type: "note",
          content:
            "Redis caching implemented for user endpoints. 60% improvement.",
          timestamp: "2025-01-16T14:30:00Z",
        },
      ],
      children: [],
      parent: "gb-004",
    },

    "gb-007": {
      id: "gb-007",
      name: "Dashboard UI Implementation",
      author: { name: "Lisa Zhang", initials: "LZ" },
      goal: "Build new analytics dashboard with real-time data visualization.",
      result: null,
      status: "pending",
      evidence: [
        {
          id: "ev-060",
          type: "link",
          url: "https://figma.com/file/dashboard",
          title: "Dashboard Designs",
          timestamp: "2025-01-10T09:00:00Z",
        },
        {
          id: "ev-061",
          type: "note",
          content: "Waiting for API endpoints before starting implementation",
          timestamp: "2025-01-15T11:00:00Z",
        },
      ],
      children: [],
      parent: "gb-004",
    },

    "gb-008": {
      id: "gb-008",
      name: "Customer Onboarding Flow",
      author: { name: "Rachel Green", initials: "RG" },
      goal: "Design and implement new customer onboarding experience to improve activation rates.",
      result:
        "New flow increased activation by 34%. Average time to first value reduced from 12 min to 4 min.",
      status: "complete",
      evidence: [
        {
          id: "ev-070",
          type: "note",
          content: "Analyzed current funnel. 40% drop-off at step 3.",
          timestamp: "2025-01-05T10:00:00Z",
        },
        {
          id: "ev-071",
          type: "link",
          url: "https://hotjar.com/recording/abc",
          title: "User Session Recordings",
          timestamp: "2025-01-06T14:00:00Z",
        },
        {
          id: "ev-072",
          type: "file",
          name: "onboarding-redesign.fig",
          size: "12.4 MB",
          timestamp: "2025-01-08T11:00:00Z",
        },
        {
          id: "ev-073",
          type: "note",
          content:
            "User testing complete. 8/10 participants completed flow successfully.",
          timestamp: "2025-01-12T16:00:00Z",
        },
        {
          id: "ev-074",
          type: "note",
          content: "Deployed to production. Monitoring metrics.",
          timestamp: "2025-01-15T09:00:00Z",
        },
      ],
      children: [],
      parent: null,
    },
  },

  // Root nodes (no parent)
  rootNodes: ["gb-001", "gb-004", "gb-005", "gb-008"],

  // Helper methods
  getNode(id) {
    return this.nodes[id];
  },

  getRootNodes() {
    return this.rootNodes.map((id) => this.nodes[id]);
  },

  getChildNodes(parentId) {
    const parent = this.nodes[parentId];
    if (!parent || !parent.children) return [];
    return parent.children.map((id) => this.nodes[id]);
  },

  getParentChain(nodeId) {
    const chain = [];
    let current = this.nodes[nodeId];

    while (current && current.parent) {
      current = this.nodes[current.parent];
      if (current) chain.unshift(current);
    }

    return chain;
  },

  getAllNodes() {
    return Object.values(this.nodes);
  },

  formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    if (diff < 86400000) {
      return date.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      });
    }

    if (diff < 604800000) {
      return date.toLocaleDateString("en-US", {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      });
    }

    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  },
};
