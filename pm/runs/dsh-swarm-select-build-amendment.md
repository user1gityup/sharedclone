# DSH RUN WORKFLOW AMENDMENT — SWARM FIRST, NO COUNCIL

Amend the current run workflow so that this type of run **skips the Council entirely**.

The goal is to maximize **speed, parallel execution, and user choice**.

## STAGE 1 — PARALLEL SWARM SAMPLE GENERATION

When the run begins:

1. **Do not invoke the Council.**
2. Launch the configured **Swarm immediately**.
3. All swarm agents should run **in parallel**.
4. Each swarm agent independently produces its own sample/version of the requested work.
5. Agents should not debate, vote on, merge, or critique the other agents' samples before presentation.
6. Preserve each result separately so the user can evaluate the different approaches.

Example:

```text
USER REQUEST
      │
      ▼
   DSH ROUTER
      │
      ▼
 ┌───────────────┐
 │     SWARM     │
 └───────────────┘
   │   │   │   │
   ▼   ▼   ▼   ▼
  A1  A2  A3  A4
   │   │   │   │
 Sample Sample Sample Sample
   1     2     3     4
```

## STAGE 2 — ONE-AT-A-TIME USER SELECTION

After all samples are complete, present them to the user **one at a time**, not as one large batch.

For each sample:

- Show the agent's actual result.
- Clearly identify which agent produced it.
- Allow the user to **select/approve**, reject, or move to the next sample.
- Record what the user liked or selected.
- Then present the next sample.

Do not force the user to compare everything simultaneously.

Example:

```text
Sample 1 → User decision
              │
              ▼
Sample 2 → User decision
              │
              ▼
Sample 3 → User decision
              │
              ▼
Sample 4 → User decision
```

Multiple agents or multiple elements from different samples may be selected.

The system should retain both:

- **which agents won**
- **what specific elements/approaches the user selected from each**

## STAGE 3 — BUILD THE REAL PRODUCT

Once the user has reviewed all samples, start a **second swarm run** to create the real production output.

Do not send the selections to a Council.

Instead:

1. Identify the winning agents and selected concepts.
2. Break the production task into components/workstreams.
3. Assign those components primarily to the agents whose samples or ideas were selected.
4. Run as many independent components **in parallel as safely possible**.
5. Winning agents may launch/use **multiple sub-agents in parallel** when that will increase speed.
6. Coordinate dependencies only where necessary.
7. Merge the completed components into the finished product.

Example:

```text
USER SELECTIONS
      │
      ▼
PRODUCTION ORCHESTRATOR
      │
 ┌────┼────┬────┐
 ▼    ▼    ▼    ▼
A1   A2   A3   A1
│     │    │     │
├─a   ├─a  ├─a   ├─c
├─b   ├─b  └─b   └─d
└─c   └─c
│     │    │     │
└──── PARALLEL ──┘
      │
      ▼
 INTEGRATION
      │
      ▼
 FINAL PRODUCT
```

## SPEED-FIRST EXECUTION RULE

For this workflow, optimize primarily for **wall-clock completion time**.

The orchestrator should:

- parallelize independent tasks aggressively
- avoid unnecessary sequential handoffs
- avoid Council deliberation
- avoid agents waiting for other agents unless a dependency requires it
- allow winning agents to fan out work to multiple parallel sub-agents
- divide large workstreams into smaller parallel tasks where useful
- begin executable work as soon as its required inputs are available rather than waiting for every unrelated task to finish

The target behavior is:

**SWARM → SAMPLES → USER SELECTION → WINNING-AGENT PRODUCTION SWARM → PARALLEL BUILD → INTEGRATED PRODUCT**

Not:

**SWARM → COUNCIL → DISCUSSION → USER → COUNCIL → PRODUCTION**

## USER AUTHORITY

The swarm does **not** decide which sample is best.

The user is the selector.

The system may organize and present the samples, but it must not replace the user's selection with a Council vote, automatic ranking, or merged consensus.

Once selections are complete, the production swarm should treat those selections as the design/implementation direction.

## IMPLEMENTATION REQUIREMENT

Review the existing DSH run architecture and modify the minimum necessary components to support this workflow without breaking existing run modes.

This should become a distinct configurable run strategy so other workflows can still use the Council when desired.

Suggested strategy name:

`SWARM_SELECT_BUILD`

Core lifecycle:

```text
SWARM_SELECT_BUILD
    1. parallel_sample_swarm
    2. sequential_user_review
    3. capture_winners_and_selected_elements
    4. decompose_production_work
    5. parallel_winner_swarm
    6. parallel_subagent_fanout
    7. integrate
    8. deliver
```

Prioritize **speed, parallelism, preservation of user choice, and minimal unnecessary orchestration overhead**.
