# OmniObserve Prior Study Protocol v1

## 1. Study Overview

### 1.1 Motivation and Research Gap

Group brainstorming and group decision-making are widely used in classrooms and workplaces, but they often underperform because of hidden group dynamics. Participants may withhold doubts, disagreements, or novel ideas because they feel uncertain, do not want to interrupt, worry about evaluation, or believe they are alone in holding a minority view. As a result, some valuable insights may never appear in the public discussion [cite].

Existing AI facilitators usually operate on what has already been said or typed, such as group chat, real-time transcripts, or meeting summaries. These systems can organize public discourse, but they cannot help with ideas that remain unspoken. If the best ideas stay silent, a facilitator that only analyzes the public channel will not see them.

The central question of this study is: Can an AI facilitator help bring silent ideas to light without disrupting the main discussion or taking agency away from participants?

### 1.2 Our Approach: Front-Back Channel Framework

OmniObserve uses a front-back channel framework to bridge public discussion and private thought.

- **Front channel**: public group discussion, including public voice, group chat, public transcript, and shared ranking.
- **Back channel**: each participant's private thoughts, including quick voice input, text notes, doubts, disagreements, emerging ideas, and ranking rationales.
- **AI facilitation layer**: the system detects alignment or mismatch across private thoughts and between private thoughts and public discourse without directly exposing private content.

The system does not speak for participants. It supports three transition steps:

1. **Capture private signals**: record doubts, disagreements, and supporting reasons through lightweight private input.
2. **Connect shared unspoken thoughts**: identify when multiple participants have similar ideas that have not yet surfaced publicly.
3. **Scaffold transition into public discussion**: cue participants that they may not be alone in a thought, while leaving whether, when, and how to share under participant control.

This pilot uses the Lost at Sea group-ranking task because it naturally creates disagreement, minority views, confidence gaps, and competing rationales. Although it is not an open-ended creativity task, it provides an observable setting for private-to-public transition: participants may privately hold a rationale but fail to raise it publicly because of social pressure, timing, or uncertainty.

### 1.3 Design Considerations

| ID | Design consideration | OmniObserve design implication |
| --- | --- | --- |
| D1 | Reduce cognitive load: the backchannel should not compete with the main discussion. | Support lightweight private input such as quick voice or short text; prioritize cues about private-public mismatch or shared unspoken thoughts rather than requiring long-form input. |
| D2 | Minimize disruption: avoid interrupting the primary discussion flow. | Surface cues only when the system detects shared unspoken alignment or salient private-public mismatch. Cues should be brief, sparse, and ignorable. |
| D3 | Preserve agency: participants decide if and when to share. | The system never automatically publishes private thoughts or reveals another participant's private reasoning. Cues provide social support and timing hints, but participants control public sharing. |

### 1.4 Key Hypotheses

This study replaces open-ended RQs with hypotheses and aligns logs, observations, and interviews to each hypothesis.

| Hypothesis | Claim | Main evidence |
| --- | --- | --- |
| H1 | Awareness of shared unspoken thoughts increases confidence in expressing disagreement. | Disagreement after cue display, interview accounts of increased confidence, private disagreement converted into public disagreement. |
| H2 | Early signals of shared support for unspoken ideas lead to higher-quality contributions. | Contributions after cues include reasons, evidence, comparisons, alternatives, or integration; group-ranking quality as secondary evidence. |
| H3 | Participants are more receptive to interruptions when surfaced ideas demonstrate prior alignment. | Participants describe cue timing as grounded rather than disruptive; constructive uptake after cue display. |
| H4 | Control over if and when to share increases participants' willingness to externalize ideas in the private channel. | Quantity, specificity, and type of private inputs; interview accounts of privacy and control. |

The goal is not only to compare final task scores. Because this is a small pilot, the main evidence should come from system logs, observation notes, and post-study interviews about private-to-public idea movement.

### 1.5 Study Conditions

This study uses a between-subjects pilot design with two groups. Each group has three discussants. If a confederate is used, the confederate should replace one discussant rather than add a fourth person, so the three-person group structure remains consistent.

| Group | Condition | Description |
| --- | --- | --- |
| Control Group | Front channel + private capture only | Participants use the platform for private thinking and public discussion, and the system logs private input, but no shared unspoken thought cue is shown. |
| Experimental Group | Front-back channel cue | During group discussion, the system may show cues based on private thoughts, public discourse, and detected alignment across participants. |

The control condition should keep the same core task, public discussion, ranking interface, public transcript, private input, and group chat when possible. It should remove the core intervention: converting backchannel alignment into public-discussion cues.

### 1.6 Participants

Each group includes three discussants. Preferred criteria:

- Participants do not know the Lost at Sea standard answer.
- Participants are not part of the OmniObserve development team.
- Participants should not know the exact research hypothesis about shared unspoken thoughts and speaking behavior.
- If possible, participants should not already be close collaborators.
- If a confederate is used, the other participants should not know this during the task, but the deception must be explained in the debrief.

### 1.7 Setting

Participants are placed in three separate rooms or classrooms. They communicate only through OmniObserve.

Reasoning:

- Simulates an online meeting setting.
- Prevents face-to-face eye contact and body language from dominating the discussion.
- Protects the private board and private mic from being seen by other participants.
- Lets observers record interaction problems and critical incidents without interrupting the task.

Each room should have:

- One laptop or desktop computer.
- Stable internet connection.
- Microphone and speaker or headset.
- OmniObserve session URL.
- Participant ID, such as P1, P2, or P3.
- Task instruction sheet.
- One observer note sheet for the researcher.

## 2. Materials

Prepare these before participants arrive:

- OmniObserve session link for each participant.
- Admin page for phase switching, timer, cue control, and monitoring.
- Lost at Sea task description.
- Consent form or verbal consent script.
- Participant instruction sheet.
- Observer note sheet.
- Post-study interview guide.
- Audio recorder for interviews.
- Backup communication channel for researchers.
- Backup plan if the system fails, such as screenshots, screen recording of researcher monitor, or manual note taking.

## 3. Recruitment Email

Subject: Invitation to participate in an online collaboration study

您好，

我們是顏羽君教授 HAIX Lab 的研究團隊，正在進行一項關於線上協作討論系統的使用者研究，想邀請您參與一次約 60 到 90 分鐘的實驗。

在研究中，您會和另外兩位參與者一起完成一個小組決策任務。流程包含個人思考、小組線上討論，以及實驗後的簡短訪談。過程中我們會記錄系統操作資料、討論內容與訪談錄音。資料只會用於學術研究分析，並會以匿名方式整理。

參與條件：

1. 能使用電腦與麥克風進行線上討論。
2. 願意在實驗中進行個人思考與小組討論。
3. 實驗前請不要搜尋或查詢任務相關答案。

實驗長度：約 60 到 90 分鐘  
研究團隊：顏羽君教授 HAIX Lab 研究團隊

若您願意參與，請回覆確認，我們將另行提供實驗時間、地點及系統連結。謝謝！

## 4. Experiment Timeline

The target duration is 70 to 80 minutes. If time is tight, reduce interview length before removing the interview entirely.

| Time | Phase | Activity |
| ---: | --- | --- |
| 0-5 min | Arrival and consent | Welcome participants, explain recording and data use, remind them not to search for answers. |
| 5-10 min | Room assignment and device check | Bring participants to separate rooms, check browser, mic, audio, and participant ID. |
| 10-15 min | Interface familiarization | Explain public mic, private mic, ranking board, public transcript, private ideas, and group chat. |
| 15-20 min | Practice task | Use a simple unrelated task to practice private input and public speaking. |
| 20-25 min | Task briefing | Introduce Lost at Sea and the final group ranking goal. |
| 25-30 min | Phase 1: Individual thinking | Participants create their own ranking and explain reasons through private input. |
| 30-45 min | Phase 2: Group discussion | Participants discuss for 15 minutes and form one group ranking. |
| 45-50 min | Final answer | Participants submit or confirm the final group ranking. |
| 50-70 min | Post-study interview | Interview participants individually using observer notes and cue-specific questions. |
| 70-80 min | Debrief | Explain study purpose, conditions, cue mechanism, and deception if a confederate was used. |

## 5. Researcher Roles

| Role | Responsibility |
| --- | --- |
| Lead facilitator | Runs opening, explains rules, controls timing, leads debrief. |
| Admin | Switches phases, monitors session state, controls cue condition, checks logs. |
| Observer P1 | Observes P1 interaction and writes critical incident notes. |
| Observer P2 | Observes P2 interaction and writes critical incident notes. |
| Observer P3 | Observes P3 interaction and writes critical incident notes. |
| Confederate, optional | Acts as a participant and presents a strong but incorrect argument at scripted moments. |

If the team has fewer researchers, the admin can also observe one participant. The lead facilitator should avoid taking too many notes during the study because they need to manage timing and instructions.

## 6. Opening Script

Each participant goes directly to their assigned room upon arrival. The researcher in each room reads this individually.

> 你好，謝謝你今天來參與我們的使用者研究。
>
> 今天的研究會請你們使用一個線上協作討論系統，和另外兩位參與者一起完成一個小組決策任務。整個流程包含三個部分：第一，個人思考；第二，小組討論；第三，簡短訪談。
>
> 研究過程中，我們會記錄系統中的操作資料、討論內容與訪談錄音。這些資料只會用於研究分析，之後整理時會匿名處理，不會把你的名字和具體發言直接對外公開。
>
> 你可以在任何時間停止參與，也可以選擇不回答任何訪談問題。
>
> 在實驗過程中，請不要使用 Google、ChatGPT、搜尋引擎或其他外部資料查詢任務答案，因為我們想觀察的是你們如何根據自己的判斷進行討論。

## 7. Individual Room Script

> 今天每位參與者都會在自己的教室裡進行實驗，你們會透過系統中的語音和文字功能和其他參與者討論。
>
> 這樣安排的原因是，我們想模擬線上討論情境，讓大家主要透過系統進行互動，而不是依靠現場眼神或肢體動作。
>
> 我會在這裡協助你設備設定，也會觀察你和系統互動的情況，方便之後訪談時詢問你的使用經驗。我不會把你的個人想法直接分享給其他參與者。

## 8. Interface Familiarization

### 8.1 Script

> 現在請看你的畫面。你會看到任務區、討論區，以及你自己的個人想法區。
>
> 等一下你會用到兩種主要功能。
>
> 第一個是公開發言。當你使用公開麥克風時，其他參與者會聽到你說的話，這些內容也會成為小組討論的一部分。
>
> 第二個是個人想法記錄。這個功能是給你自己整理想法用的，其他參與者不會直接看到你在這裡說了什麼或寫了什麼。
>
> 請特別注意畫面上的麥克風狀態。如果你要公開講話，請確認目前是公開狀態；如果你只是想記錄自己的想法，請確認目前是在個人想法記錄狀態。
>
> 你也可以透過文字輸入記錄想法或在公開聊天室中發言。

### 8.2 Researcher Checklist

Before continuing, confirm each participant can:

- Identify their own participant ID.
- See the ranking task area.
- Use or understand the public mic.
- Use or understand private thought recording.
- Use or understand manual private idea input.
- Use or understand group chat.
- Recognize which mic state is active.
- Drag or update ranking items.

## 9. Interface Walkthrough

The interface loads the actual task content (Lost at Sea) from the start; there is no separate practice topic. The researcher walks the participant through each feature area one by one and confirms familiarity before proceeding.

Suggested walkthrough order:

1. **Task area**: Ask the participant to read the task description and item list on screen, and confirm they can see all content.
2. **Private thought recording**: Ask the participant to try typing or speaking a thought using the private input feature, and confirm they understand it is private and not visible to others.
3. **Public mic**: Ask the participant to check the mic status indicator, try switching it, and say a sentence — confirm they understand public speech is heard by other participants.
4. **Group chat**: Ask the participant to try sending a text message in the group chat, and confirm they can find the input field.
5. **Ranking interface**: Ask the participant to try dragging or updating one item’s rank, and confirm the ranking interaction works for them.

After the walkthrough, the researcher says:

> 好，你已經知道每個區塊怎麼用了。接下來我會說明今天的正式任務內容。

## 10. Task Briefing: Lost at Sea

### 10.1 Script

> 接下來的任務叫做 Lost at Sea。
>
> 請想像你們是一組在海上遇難的人。你們現在有一批物品，但無法全部同等重視，因此需要判斷哪些物品對生存和獲救最重要。
>
> 你們會先各自思考 5 分鐘，產生自己的排序與理由。這個階段請不要和其他人討論。
>
> 接著你們會進入 15 分鐘的小組討論。你們需要一起討論並產生一份小組最終排序。
>
> 請注意，過程中不要上網查答案，也不要使用任何外部工具搜尋這個任務。這個任務的重點不是考你是否知道標準答案，而是觀察你們如何討論、表達理由、形成共識。

### 10.2 Participant Task Rules

- Do not search the internet.
- Do not ask ChatGPT or other external tools.
- First make your own ranking independently.
- During group discussion, produce one final group ranking.
- You may disagree, revise, or explain uncertainty.
- The group does not need complete agreement, but must submit one final answer.

## 11. Phase 1: Individual Thinking

Duration: 5 minutes.

### 11.1 Participant Instruction

> 現在請你自己思考 5 分鐘。
>
> 請先不要和其他人討論。
>
> 你需要完成兩件事：第一，排出你自己的物品順序；第二，盡量用個人想法記錄功能說出或寫下你的理由。
>
> 你不需要把理由講得很完整，可以是直覺、疑問、反對某個物品的理由，或你覺得某個物品重要的原因。這些內容主要是幫助你自己在等一下的小組討論中回想。

### 11.2 Data to Capture

- Initial individual ranking.
- Private transcripts.
- Manual private inputs.
- Generated idea blocks.
- Item links detected from each idea block.
- Similarity pairs generated during the private phase, if the backend computes them.
- Ranking movement history.
- Mic state and input behavior.

Important: cues should not be shown during the individual thinking phase, even if the system computes similarity or shared unspoken alignment in the background.

## 12. Phase 2: Group Discussion

Duration: 15 minutes.

### 12.1 Control Group Script

> 現在請你們開始小組討論。
>
> 你們有 15 分鐘，需要在時間內產生一份小組共同排序。
>
> 你們可以自由討論、提出理由、反對或修改排序。最後請提交一份小組最終答案。

### 12.2 Experimental Group Script

> 現在請你們開始小組討論。
>
> 你們有 15 分鐘，需要在時間內產生一份小組共同排序。
>
> 系統有時候可能會根據你先前記錄的想法，提醒你有些內容可能和目前討論有關，或可能也有其他人有相近想法。你可以自行決定是否採納、忽略，或把它帶入討論。系統不會自動替你公開你的個人想法，也不會公開其他人的個人想法。

### 12.3 Suggested Cue Text

Use one of these cue styles:

> 你不是唯一對「{item}」有這個方向想法的人。若你覺得合適，可以把你的觀點帶入討論。

> 你先前提到的「{idea_summary}」和目前討論可能有落差。若你想補充，可以選擇現在或稍後提出。

> 目前有不只一個人私下提到與「{item}」相關的疑問或支持理由。你可以決定是否提出自己的版本。

The cue should provide awareness of shared unspoken alignment without exposing another participant's private reasoning. The system should connect participants based on conclusion alignment, decision-level alignment, or private-public mismatch, not necessarily identical reasoning. Cues should be sparse: if there is only one private thought and no alignment or mismatch, the system should usually stay silent.

### 12.4 If a Confederate Is Used

The confederate should:

- Pretend to be a normal participant.
- Use a prepared script.
- Present strong but plausible incorrect arguments.
- Avoid obviously absurd reasoning.
- Avoid dominating so much that real participants cannot speak.
- Create situations where real participants may privately disagree but need confidence and timing to challenge publicly.
- Leave room after disagreement so researchers can observe whether public discussion accepts the challenge.

The confederate role must be explained during debrief, and participants must be allowed to withdraw their data afterward.

## 13. End of Discussion

### 13.1 Script

> 時間到，小組討論到此結束。

The researcher captures the current state of the group ranking directly from the interface. No submission action is required from participants.

### 13.2 Data to Capture

- Final group ranking.
- Difference between each individual ranking and the group ranking.
- Difference between group ranking and standard answer.
- Public transcript.
- Public chat messages.
- Cues shown, cue timing, cue recipient, and linked idea blocks.
- Whether cued ideas appeared in public discussion after cue display.
- Whether the public discussion accepted, ignored, or resisted the cued idea.
- Whether private thoughts include doubts, disagreements, novel ideas, and support signals.
- Whether detected shared unspoken thoughts became public contributions.

## 14. Observer Note Sheet

Each observer should use [`observation-cheatsheet.zh.md`](./observation-cheatsheet.zh.md) as the read-only observation reminder and one copy of [`observation-notion-template.zh.md`](./observation-notion-template.zh.md) as the per-participant record sheet. Observers should record critical incidents, not full transcripts. Focus on moments that can become concrete interview questions.

The record sheet covers:

- Record fields for each experiment phase.
- Critical incident records.
- Semi-structured interview response fields.
- Post-interview summary fields for H1-H4.

## 15. Post-study Interview Guide

Interview participants individually. Target 8 to 12 minutes per participant. Do not begin by saying that the study is testing whether cues made them speak; ask about experience first, then private-to-public movement and critical incidents.

Use the "Page 2. 半結構式訪談問什麼" section in [`observation-cheatsheet.zh.md`](./observation-cheatsheet.zh.md) as the interview reminder, and record responses in the "Page 2. 半結構式訪談記錄" section in [`observation-notion-template.zh.md`](./observation-notion-template.zh.md).

## 16. Debrief Script

### 16.1 Standard Debrief

> 謝謝你完成今天的研究。
>
> 我們這次研究主要想了解，在小組討論中，系統是否能幫助參與者把個人階段想到、但可能沒有說出來的想法帶入公開討論。特別是當不只一個人私下有相近的疑問、支持或不同意見時，系統能否提供適當提醒，讓參與者更有信心決定是否提出。
>
> 有些組別會看到系統提示，有些組別不會。這是我們研究設計的一部分，用來比較提示是否影響討論行為。
>
> 系統不會自動公開你的個人想法，也不會把你的 private reasoning 直接給其他人看。提示的目的是提供可能的 shared alignment 或討論時機，但是否提出、何時提出、怎麼提出仍由你自己決定。
>
> 你的資料會匿名處理，只用於研究分析。

### 16.2 Additional Debrief If a Confederate Was Used

> 另外，今天討論中有一位參與者是研究團隊安排的成員。他的任務是在討論中提出某些具有說服力、但不一定正確的觀點。
>
> 這是為了觀察當小組中出現較強勢的意見時，其他參與者是否會先在 private channel 留下不同想法，以及系統提示是否能幫助 shared unspoken disagreement 被帶入公開討論。
>
> 我們不會用這個設計評價你的能力或表現，而是分析系統與討論過程。
>
> 如果你對這個安排感到不舒服，可以告訴我們，我們可以刪除你的資料。

## 17. Measures

### 17.0 Hypothesis-to-measure Mapping

| Hypothesis | Observable phenomenon | Data source |
| --- | --- | --- |
| H1 confidence in disagreement | Participants become more willing to express disagreement after becoming aware of shared unspoken thoughts. | Disagreement after cues, interview accounts of confidence, private disagreement to public disagreement conversion. |
| H2 quality of contribution | Early private support becomes more elaborated public contribution. | Whether public contributions include reasons, evidence, comparison, integration, or alternatives; final ranking improvement as secondary evidence. |
| H3 interruption receptivity | Participants treat cues as grounded reminders rather than disruptions. | Cue noticed, cue ignored, cue perceived as helpful/disruptive, public uptake after cues. |
| H4 willingness to externalize privately | Participant control increases willingness to leave thoughts in the private channel. | Quantity, length, type, and specificity of private input; interview accounts of privacy and control. |

### 17.1 Quantitative Measures

| Measure | Calculation |
| --- | --- |
| Individual score | Sum of absolute ranking differences between participant ranking and standard answer. Lower is better. |
| Group score | Sum of absolute ranking differences between final group ranking and standard answer. Lower is better. |
| Improvement from individual to group | Average individual score minus group score. |
| Private-to-public conversion rate | Private ideas later appearing in public discussion divided by all private ideas. |
| Shared unspoken conversion rate | Shared unspoken private ideas later appearing in public discussion divided by all shared unspoken private ideas. |
| Cue uptake rate | Cues followed by related public contribution divided by all cues shown. |
| Ignored cue rate | Cues not followed by related public contribution divided by all cues shown. |
| Disagreement expression rate | Private disagreements later expressed publicly, or number of public disagreement turns per participant. |
| Private externalization rate | Number, average length, type, and task-item coverage of private ideas per participant. |
| Cue receptivity rating | Interview or questionnaire rating of whether cues were helpful, disruptive, and well timed. |
| Contribution quality score | Researcher-coded quality of public contribution, such as rationale, comparison, evidence, integration, or new perspective. |
| Speaking turns | Number of public speaking turns per participant. |
| Speaking duration | Total public speaking time per participant, if available. |
| Ranking change count | Number of item moves per participant and group. |
| Private-public mismatch cases | Number of private-public rank or idea differences above threshold, such as more than 2 positions. |

### 17.2 Qualitative Codes

| Code | Description |
| --- | --- |
| private idea surfaced | A private idea was later raised publicly. |
| private idea suppressed | A private idea was not raised publicly. |
| cue noticed | Participant noticed the cue. |
| cue ignored | Participant noticed the cue but did not act on it. |
| cue prompted speaking | Participant reported that a cue contributed to speaking. |
| shared unspoken alignment | Two or more participants expressed similar private thoughts that had not surfaced publicly. |
| private-public mismatch | A participant's private thought differs from public discussion or the group ranking. |
| disagreement expressed | Participant publicly disagreed, challenged, or expressed reservation. |
| disagreement withheld | Participant had a private disagreement but did not raise it publicly. |
| contribution elaborated | Public contribution included rationale, comparison, evidence, assumptions, or integration. |
| interruption accepted | Participant perceived cue timing as reasonable or public discussion took up the cued idea. |
| interruption resisted | Participant perceived cue as disruptive or public discussion ignored/rejected the cued idea. |
| uncertainty | Participant was unsure whether their idea was correct or worth saying. |
| timing barrier | Participant did not know when to interrupt or enter the discussion. |
| social pressure | Participant held back because of dominant opinion or group consensus. |
| system confusion | Participant misunderstood mic state, cue meaning, or controls. |
| privacy concern | Participant worried that private thoughts could be seen by others. |

## 18. Data Collection Checklist

Before the study:

- [ ] Participant IDs assigned.
- [ ] Session links generated.
- [ ] Cue condition set correctly.
- [ ] Admin page ready.
- [ ] Mic and audio tested.
- [ ] Task description ready.
- [ ] Observer sheets ready.
- [ ] Interview recording device ready.

During the study:

- [ ] Consent completed.
- [ ] Participants reminded not to search for answers.
- [ ] Practice task completed.
- [ ] Individual ranking captured.
- [ ] Private transcripts and idea blocks captured.
- [ ] Group discussion transcript captured.
- [ ] Cue logs captured for experimental condition.
- [ ] Shared unspoken alignment and private-public mismatch cases marked.
- [ ] Final group ranking captured.
- [ ] Observer notes written with timestamps.

After the study:

- [ ] Individual interviews recorded.
- [ ] Debrief completed.
- [ ] Confederate disclosed, if used.
- [ ] Participants given chance to withdraw data after debrief.
- [ ] Logs exported or backed up.
- [ ] Researchers write short memo while memory is fresh.

## 19. Risk Mitigation

### 19.1 Privacy

Participants may worry that private thoughts are visible to others. Researchers should clearly explain that private thoughts are not directly shared with other participants. Observers may see interaction behavior for research purposes, but should not disclose private content to other participants.

### 19.2 Mic State Confusion

Public microphone state must be visually clear. Before the formal task begins, participants must demonstrate that they understand public mic vs private thought recording.

### 19.3 Task Answer Leakage

Because Lost at Sea has a standard answer, participants must be told not to search the internet or use external tools. If a participant reveals that they know or searched the answer, record it and consider excluding that session from score-based analysis.

### 19.4 Cue Overexposure

Do not over-explain the shared unspoken thought cue before the task. If participants focus only on the cue, the study may become less natural. The experimental group only needs to know that the system may sometimes show relevant reminders, and that they control whether to act on them.

### 19.5 Confederate Deception

If a confederate is used, the team must debrief participants afterward and allow withdrawal. The confederate should avoid making participants feel personally judged or tricked.

## 20. Minimal Run-of-Show

Use this as the quick checklist on experiment day.

1. Welcome participants and complete consent.
2. Remind participants not to search for answers.
3. Move participants to separate rooms.
4. Check participant ID, mic, audio, and system link.
5. Explain public mic, private thought recording, ranking, transcript, and chat.
6. Run a short practice task.
7. Introduce Lost at Sea.
8. Start 5-minute individual thinking phase.
9. Save or confirm individual ranking.
10. Start 15-minute group discussion phase.
11. For experimental group, enable shared unspoken thought cue during group phase only.
12. Submit final group ranking.
13. Conduct individual interviews using observer notes.
14. Debrief participants.
15. Export logs and write researcher memo.
