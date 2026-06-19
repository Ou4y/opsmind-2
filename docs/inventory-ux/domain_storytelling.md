# OpsMind Inventory Domain Storytelling

Format:
- Actor
- Action
- Sequence Number
- Object
- Assumptions/Preconditions

## Story A: Import Full Asset Kit
### Preconditions
- User has inventory admin permission.
- CSV contains parent and related rows.
- Parent tags are unique and valid.

| Seq | Actor | Action | Object |
| --- | ----- | ------ | ------ |
| 1 | Inventory Admin | Upload file and run preview | CSV rows |
| 2 | System | Normalize and validate rows | Parent, component, accessory, license, consumable, spare stock records |
| 3 | Inventory Admin | Resolve warnings/errors | Preview table and AI repair panel |
| 4 | Inventory Admin | Confirm import | Validated normalized rows |
| 5 | System | Create/link records by order | Parent assets, related assets, component links, relationships |
| 6 | System | Return batch summary | Batch ID, timestamp, counts, warnings, failed rows |

## Story B: AI Repair Import Errors
### Preconditions
- Preview already exists and has normalized rows.
- AI service may be available or fallback-enabled.

| Seq | Actor | Action | Object |
| --- | ----- | ------ | ------ |
| 1 | Inventory Admin | Run AI repair | Preview rows |
| 2 | System | Generate deterministic and/or AI suggestions | Suggested fixes with confidence and safety flags |
| 3 | Inventory Admin | Apply safe or selected suggestions | Pending suggestion rows |
| 4 | System | Revalidate preview | Updated rows and validation results |
| 5 | Inventory Admin | Confirm import only if blocking errors are clear | Commit action |

## Story C: Transfer Parent Asset with Related Items
### Preconditions
- User has transfer permission.
- Parent exists.

| Seq | Actor | Action | Object |
| --- | ----- | ------ | ------ |
| 1 | Technician/Senior | Open transfer modal | Parent asset |
| 2 | User | Select destination and related-item options | Building/department, components/accessories/licenses/consumables toggles |
| 3 | System | Show related item summary | Related counts |
| 4 | User | Confirm transfer | Transfer request |
| 5 | System | Transfer parent and selected related items | Asset and related entities |
| 6 | System | Record history/timeline events | Lifecycle events and audit trail |

## Story D: Audit and Mark Missing
### Preconditions
- Auditor/admin access.

| Seq | Actor | Action | Object |
| --- | ----- | ------ | ------ |
| 1 | Auditor | Open audit board | Audit list |
| 2 | Auditor | Review stale/mismatch/missing rows | Candidate assets |
| 3 | Auditor | Mark verified or missing | Verification action |
| 4 | System | Persist audit status and event trail | Asset specs + lifecycle events |
| 5 | Auditor | Recheck board summary | Updated counts |

## Story E: Loaner Checkout and Return
### Preconditions
- Asset category is loaner-eligible in workflow.

| Seq | Actor | Action | Object |
| --- | ----- | ------ | ------ |
| 1 | Technician/Admin | Open loaner board | Eligible assets |
| 2 | User | Checkout to borrower | Borrower + expected return metadata |
| 3 | System | Persist loaner status and timeline events | Asset state |
| 4 | User | Return asset | Return request |
| 5 | System | Restore return status/location and log events | Loaner lifecycle state |

## Story F: View Parent CMDB and Related Components/Licenses
### Preconditions
- Parent asset exists.

| Seq | Actor | Action | Object |
| --- | ----- | ------ | ------ |
| 1 | Technician/Admin | Open CMDB details | Parent asset |
| 2 | System | Fetch components, relationships, maintenance, events | CMDB datasets |
| 3 | User | Inspect components and related licenses/accessories | Relationship tabs |
| 4 | User | Open digital twin and timeline for context | AI/analytic panels |
| 5 | System | Provide summarized operational/risk state | CMDB insights |

## Story Quality Notes
- All high-impact actions require explicit user intent (preview before commit, confirm before destructive actions).
- AI guidance supports decision-making but should not silently mutate committed inventory data.
