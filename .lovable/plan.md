

Let me explore the current Overview page and related campaign data to understand what's available and what could be more valuable.
<lov-tool-use id="toolu_vrtx_01VkDGyLQ3BTa8x4T7hHo4L8" name="code--view" integration-id="code" data="{\"file_path\": \"src/components/campaigns/CampaignOverview.tsx\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01JK7nD1Ts2DFnY8ruXrsNNw" name="code--view" integration-id="code" data="{\"file_path\": \"src/hooks/useCampaigns.tsx\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01Si9KAdnu63aCWATLwMuHw1" name="code--view" integration-id="code" data="{\"file_path\": \"src/components/campaigns/CampaignOverview.tsx\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_0123oshYKZx3A5SLivuxkZM4" name="code--view" integration-id="code" data="{\"file_path\": \"src/hooks/useCampaigns.tsx\"}">
</lov-tool-use>
<lov-plan>

# Campaign Overview – Smarter Widgets & Charts

## What's wrong with the current Contact Funnel
- Bars are sized relative to the **largest stage**, so a single "Responded" looks like a full bar while 0s look identical to small numbers — visually misleading.
- It doesn't behave like a real funnel (each stage should be ≤ previous). Today every contact only ever sits in one stage, so "Not Contacted = 50, Contacted = 0, Responded = 1" is meaningless as a funnel.
- No conversion rates between stages, no totals, no comparison with outreach actually sent.

## Fix the Funnel + add meaningful widgets

### 1. Replace "Contact Funnel" with a true **Engagement Funnel**
Compute cumulative counts (each stage rolls up the next):
- **Total Contacts** = all contacts
- **Contacted** = Contacted + Responded + Qualified + Converted (anyone who has been reached)
- **Responded** = Responded + Qualified + Converted
- **Qualified** = Qualified + Converted
- **Converted** = Converted

Display as a proper descending funnel with:
- Bar width = % of Total Contacts (not relative to max)
- Each row shows count, % of total, and **conversion % from previous stage** (e.g. "32% of Contacted responded")
- Color gradient slate → blue → amber → purple → emerald

### 2. New widget: **Outreach Channel Mix** (donut)
Shows split between Email / Call / LinkedIn with counts and %. Replaces the cramped "✉ ☎ in" subtext on the Outreach KPI. Uses recharts `PieChart`.

### 3. New widget: **Response Rate by Channel** (horizontal bars)
For each channel: messages sent vs responses received → response rate %. Helps user see which channel is actually working.

### 4. New widget: **Top Engaged Accounts** (list, top 5)
Ranked by number of communications + contacts that responded. Click → jumps to Setup tab. Shows account name, # contacts, # touches, response badge.

### 5. New widget: **Campaign Health** card
At-a-glance KPIs:
- Days remaining / total days (progress bar)
- Coverage: % of contacts contacted at least once
- Avg touches per contact
- Pipeline value (sum of deal values from this campaign)

### 6. Improve **Outreach Activity** chart
- Add stacked series per channel (Email / Call / LinkedIn) instead of a single line
- Switch from weekly area to stacked bar by week — easier to read mix over time

### 7. Keep Recent Activity & Campaign Details (already good)

## New layout (top → bottom)

```text
[ KPI strip — 6 cards ]                                  (unchanged)

[ Engagement Funnel        7 ] [ Channel Mix donut    5 ]
[ Response Rate by Channel 7 ] [ Campaign Health      5 ]
[ Outreach Activity (stacked, full width)              ]
[ Top Engaged Accounts 7   ] [ Recent Activity     5  ]
[ Campaign Details (full width, unchanged)             ]
```

## Files to edit
| File | Change |
|---|---|
| `src/components/campaigns/CampaignOverview.tsx` | Replace funnel logic with cumulative funnel; add ChannelMix donut, ResponseRateByChannel, CampaignHealth, TopEngagedAccounts widgets; convert timeline to stacked bar by channel; restructure grid |

## Out of scope
- No DB / hook changes — all derived from already-fetched `accounts`, `contacts`, `communications`, `deals`.
- No changes to Setup / Monitoring tabs.

