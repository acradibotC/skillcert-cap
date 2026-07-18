# QA log — ATT-DASH-20260718

| QA ID | Background/source | Question | Proposal/options | Impact if unanswered | Owner | Due | Answer | Affected IDs | Status |
|---|---|---|---|---|---|---|---|---|---|
| QA-001 | Local UI comment vs live query source | Does live `WorkDate` filter work end-to-end? | Execute OData smoke test in integration phase | Incorrect period data | Development | G2 | User confirmed filter is real | REQ-001 | Closed |
| QA-002 | Dashboard calculation | Where does Break come from? | Standard daily work schedule; document fallback if missing | Incorrect hours | Development | G2 | User requires deduction | REQ-002 | In progress |
| QA-003 | Live S40 local-object implementation | Why does ADT reject class source lock for a newly created `$TMP` class? | Enable ADT source modification or provide an editable development package | S40 refresh/API cannot be completed | SAP Basis/Developer | G2 | `modificationSupport=NoModification` returned by S40 | REQ-001..004 | Open |
