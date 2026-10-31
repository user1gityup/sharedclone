# PM UI DESIGN SPECIFICATION

## Status
DESIGN INTERVIEW COMPLETE  
READY FOR DSH UI SAMPLE RUN

## Core direction
Project Manager should use a clean enterprise-dashboard visual language with adaptive information density, strong operational visibility, and fast resume/continuation workflows.

## Approved decisions

### 1. Home screen
**Hybrid home**
- Prominent current-work area at the top
- Projects/tasks below
- Current-work experience uses a **Recent Work / Continue Where You Left Off** launcher

### 2. Information density
**Adaptive**
- Compact by default
- Dense mode available as a toggle or saved view

### 3. Navigation
**Adaptive navigation**
- Sidebar on desktop
- Condensed drawer/navigation on smaller screens
- Command palette available everywhere

### 4. Project representation
**Hybrid**
- Compact project rows by default
- Expandable detail
- Optional card view

### 5. Task representation
**Hybrid**
- Compact task rows by default
- Expandable rich detail
- Optional board view

### 6. Active / Resume experience
**Recent Work launcher**
- Focus on the latest work the user was doing
- Prominent Resume / Open / Launch actions
- Designed to minimize session-recovery effort

### 7. Task / Run detail
**Hybrid**
- Expand in place for quick details
- Full detail view available for complex tasks/runs

### 8. Machine visibility
**Machine + health**
- Show machine assignment directly
- Show basic health/state such as Online, Busy, Offline, etc.

### 9. Agent visibility
**Agent + provider/model**
- Show enough execution identity to understand what is running
- Avoid hiding the provider/model completely

### 10. Quota / cost
**Hybrid**
- Compact percentages in normal views
- Expanded resource detail with visual bars/gauges and budget/cost information

### 11. Status display
**Colored chips + icons**
- Use both color and icons
- Do not rely on color alone
- Controlled status vocabulary:
  - READY
  - RUNNING
  - PAUSED
  - WAITING
  - BLOCKED
  - FAILED
  - VERIFY
  - COMPLETE
  - ARCHIVED

### 12. Attention / alerts
**Top alert strip + dedicated Attention panel**
- Compact alert strip for immediate awareness
- Dedicated panel for full detail

### 13. Routines
**Hybrid**
- Dedicated Routines area
- Contextual shortcuts beside relevant tasks/runs
- Examples: Quota Handoff, checkpoint/archive, recovery, sync

### 14. Creating work
**Simple + New button + guided flow**
- + New remains fast and familiar
- Guided fields appear when more structure is needed
- Support creation of Project, Task, and Run

### 15. Search / commands
**Hybrid**
- Normal global search
- Command palette for fast actions and navigation

### 16. Overall visual style
**Clean enterprise dashboard**
- Professional
- Restrained
- Clear visual hierarchy
- Avoid overly console-like or gamer-style design

### 17. Notion-inspired capabilities
**Combine all**
- Flexible views
- Table / board / grouped views
- Structured properties
- Expandable records
- Saved views
- Filters
- Sorting
- Grouping
- Do not clone Notion's visual design

### 18. Mobile
**Near full desktop-equivalent functionality**
- Mobile should support nearly all PM controls
- Includes routing, machines, advanced views, configuration where practical

### 19. Role-specific UI
**Shared core + role-adaptive controls + View As**
- One shared PM structure
- Navigation/actions/details adapt by role
- Authorized admins/managers can preview other role views

Roles:
- Admin
- Manager
- Worker
- Client

### 20. Action confirmations
**Configurable high-impact confirmations**
- Routine actions such as Resume/Open stay fast
- High-impact actions such as reroute, stop, archive, delete require confirmation
- Admins can configure confirmation policy

### 21. Theme
**Full light + dark support**
- Both are first-class themes
- Manual theme switch

### 22. Main dashboard composition
**Hybrid cards + flat operational sections**
- Use cards for high-priority information:
  - Continue
  - Attention
  - Machines/system health
  - Quota/resource summary
- Use flatter rows/tables for:
  - Projects
  - Tasks
  - Runs
  - Larger operational datasets

## Home-page concept

Suggested hierarchy based on approved decisions:

1. Header
   - Search
   - Command palette
   - + New
   - Theme switch
   - Role/View As where authorized

2. Attention strip
   - Count and severity summary
   - Link to dedicated Attention panel

3. Continue Where You Left Off
   - Recent/current work
   - Resume/Open/Launch
   - Machine + health
   - Agent + provider/model
   - Current status

4. Resource/System summary cards
   - Machines
   - Quota
   - Budget/cost
   - Critical system state

5. Projects
   - Compact expandable rows
   - Optional card view
   - Filters/saved views

6. Tasks/Runs
   - Compact rows
   - Expand-in-place
   - Full detail view
   - Optional board/grouped views

7. Routines
   - Dedicated section
   - Contextual shortcuts

## Sample requirements

The DSH UI sample run should create at least three visually distinct samples while honoring all approved decisions:

### Sample A — Operational Dashboard
Clean enterprise operations dashboard emphasizing current work, machines, quota, status, and actions.

### Sample B — Project Management / Notion-influenced
Clean enterprise project-management layout emphasizing flexible views, structured properties, filters, grouping, and expandable records.

### Sample C — Compact DSH Command Center
Higher-density operational layout emphasizing speed, resume/launch, machines, agents, and current run state while still using the approved enterprise visual language.

### Optional Sample D — Hybrid
Only if it meaningfully combines the strongest ideas and is visually distinct.

## Production gate
These are design requirements only.

Do not implement the production Project Manager UI until:
1. DSH generates the UI samples.
2. The user reviews the samples.
3. The user selects or combines a direction.
4. The final sample is approved.

## Later list
None currently.

## Blocking unresolved items
None. The specification is sufficient to begin the DSH UI Sample Run.
