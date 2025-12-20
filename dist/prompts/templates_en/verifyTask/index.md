**Please strictly follow the guidelines below**

## Task Verification

**Name:** {name}

**ID:** `{id}`

**Description:** {description}

**Notes:** {notes}

## Verification Criteria

{verificationCriteria}

## Implementation Guide Summary

{implementationGuideSummary}

## Analysis Points

{analysisSummary}

## Focus-Specific Verification Standards

### 🔬 Logic Mode Verification (Technical)
| Criteria | Weight | Check |
|----------|--------|-------|
| Functional Correctness | 35% | All requirements met, edge cases handled |
| Code Quality | 30% | Clean, maintainable, follows patterns |
| Error Handling | 20% | Graceful failures, meaningful messages |
| Performance | 15% | No obvious bottlenecks |

### 🎨 Vibe Mode Verification (Creative/UI)
| Criteria | Weight | Check |
|----------|--------|-------|
| Visual Polish | 35% | Looks professional, consistent styling |
| User Experience | 30% | Feels smooth, intuitive interactions |
| Responsiveness | 20% | Works on all screen sizes |
| Animation Quality | 15% | Smooth transitions, right timing |

### 🐛 Debug Mode Verification (Fix)
| Criteria | Weight | Check |
|----------|--------|-------|
| Bug Fixed | 40% | Original issue resolved |
| No Regression | 30% | Nothing else broke |
| Root Cause | 20% | Underlying issue addressed, not just symptom |
| Test Added | 10% | Prevent recurrence |

### 🔒 Security Mode Verification
| Criteria | Weight | Check |
|----------|--------|-------|
| Input Validation | 30% | All inputs sanitized |
| Auth/AuthZ | 30% | Proper access control |
| No Vulnerabilities | 25% | Injection, XSS, CSRF checked |
| Secure Defaults | 15% | Fail-safe behavior |

### ⚡ Performance Mode Verification
| Criteria | Weight | Check |
|----------|--------|-------|
| Measurable Improvement | 40% | Benchmarks show improvement |
| No Regression | 25% | Other areas not degraded |
| Resource Usage | 20% | Memory/CPU within bounds |
| Scalability | 15% | Handles increased load |

### ♿ Accessibility Mode Verification
| Criteria | Weight | Check |
|----------|--------|-------|
| Keyboard Navigation | 30% | All interactive elements reachable |
| Screen Reader | 25% | Proper announcements |
| Color Contrast | 25% | WCAG AA compliance (4.5:1) |
| Focus Management | 20% | Visible focus, logical order |

## Reporting Requirements

Provide overall score and rating, evaluation of each criterion based on task focus, issues and recommendations, and final conclusion.

## Next Steps

**Choose your next action based on the verification results:**

- **Critical Errors**: Use the "plan_task" tool directly to replan the task
- **Minor Errors**: Fix the issues directly
- **No Errors**: Use the "complete_task" tool directly to mark as complete

**Please decide your next action directly, do not ask the user**
