---
layout: research-post
title: Transformers with RL or SFT Provably Learn Sparse Boolean Functions, But Differently
description: In our ICML 2026 paper, we trace how reinforcement learning with process rewards and supervised fine-tuning learn the same parity calculation in different orders.
author: Zhanxing Zhu
paper_authors: Bochen Lyu, Yiyang Jia, Xiaohao Cai and Zhanxing Zhu
paper_venue: ICML 2026
paper_url: https://proceedings.mlr.press/v306/lyu26d.html
---

Suppose a student writes down two intermediate results, makes a sign error in the first, then multiplies the two numbers perfectly. How would you mark the multiplication? You could award credit for correctly multiplying the numbers on the page. You could also mark the answer against your solution sheet. Both are reasonable things to do. They give opposite feedback on the very same line of working.

This small grading decision sits at the centre of a question Bochen Lyu, Yiyang Jia, Xiaohao Cai and I studied in our ICML 2026 paper. When a transformer learns a calculation with several intermediate steps, **can it learn how to do a later step while it is still getting the earlier ones wrong?** For Boolean functions whose answers depend on a hidden subset of the input bits, we can trace the effect of that grading decision all the way down to individual attention weights.

With reinforcement learning (RL), a verifier that checks each operation against the model’s own working gives useful feedback throughout the calculation from the start. With supervised fine-tuning (SFT), a model that reads its own working but is graded against a fixed solution learns one level at a time. And if we give SFT the correct working as input during training, it too can learn the levels together. Here is [the calculation](#four-bits-hidden-among-six), [what the gradients reveal](#where-the-gradient-points), and [what happens when we change the supervision](#change-what-the-model-gets-to-see).

## Four bits hidden among six

Our inputs are lists of signs, each independently chosen to be +1 or −1. A fixed set of positions determines the answer, and the rest are distractions. We call the function *k*-sparse when it uses *k* of the input positions. For **parity**, the answer is the product of the selected signs. An even number of minus signs gives +1. An odd number gives −1.

Try it with six signs. The relevant positions in this example are the first, second, fourth and fifth. We have highlighted them below. The transformer has to discover those positions across training examples, so it does not get to see the highlighting. Follow the two pairwise products, then watch what happens to the next multiplication when the model makes a sign error.

{% include blog/parity-example.liquid %}

The input stays the same throughout. In the correct working, the left pair gives −1 and the right pair gives +1, so the answer is −1. If the model writes +1 on the left, it now has two positive numbers in front of it. Multiplying them gives +1. The mistake happened one line earlier. A check of the multiplication can say exactly where the model deserves credit even though it got the problem wrong.

There is a reason to choose parity for this exercise. Imagine trying to guess the answer from just one of the relevant signs. For every input on which your guess works, flipping another relevant sign produces an equally likely input on which it fails. That makes the final answer a poor clue to which individual positions matter. The intermediate products give us something much more specific to teach. We can ask which positions produced this particular pairwise product and whether the model has learned to look at them.

## What the transformer has to discover

In the little example above, the last multiplication has only two numbers to choose from. Try drawing the calculation for eight relevant signs. There are four pairwise multiplications on the first line, two on the second and one on the third. Now the second line also has to choose which earlier results belong together. This is the balanced binary tree in the paper. With sixteen relevant signs there are fifteen multiplications, arranged in four levels of eight, four, two and one. When we say the model learns “one step”, we mean one **level** of this tree. Several multiplications can be learned at the same level.

We reuse a one-layer, single-head transformer to generate these levels. An attention mask tells a node which level it can read. On the first level that means the entire original input, distractions included. On the next it means all the pairwise products the model just wrote down. If four such products are available, a given node needs to find its two children among the four. The mask gives it the right line of working. Learning has to pick out the right entries on that line.

We supply one other ingredient. The model already has an operation that can turn the average of the right two signs into a parity decision. To see how little machinery this takes, average two equal signs and square the result. You get one, whether both signs were positive or both negative. Average two opposite signs and square the result and you get zero. Those are exactly the probabilities of a positive product in the two cases. The trainable part is the attention that chooses what to average.

That division of labour makes the question experimentally and mathematically precise. At the start, attention is spread evenly over the visible positions. In a model that has solved the task, half the attention goes to each of the two relevant positions. We can inspect the direction of the very first update and ask whether it already favours those positions, even at a node whose inputs the model has yet to generate reliably. [Model and decomposition, Section 2](https://arxiv.org/html/2511.17852v3#S2)

## Where the gradient points

Start with RL. The model samples a calculation, and the verifier checks each node using the two child values in that sampled calculation. It knows the intended pairing, so it can multiply those values and check the proposed result. In the update we analyse, each level’s policy gradient uses that level’s reward. Over many sampled calculations we can ask a local question about an attention weight. If the model gave this position a little more weight, would its action agree more often with the verifier?

The remarkable part is how far up the tree that question already makes sense. Consider a second-level node with four candidate inputs. All four may be unreliable as answers to their original subproblems. Yet the verifier can still evaluate the product of the designated two, using their values on this particular run. A sampled calculation can therefore teach something about the *pairing* at this node even when it contains an earlier error. The first level has its own checks, so those earlier mistakes also receive feedback.

We turn that observation into a sufficient condition. For each node, we isolate a term in the expected gradient and compare its value at a relevant position with its value at an irrelevant one. When the relevant positions consistently come out ahead in this comparison, the update increases their share of attention. We verify the condition analytically for parity. We also verify it for AND and OR, with a different activation for each gate. These cases matter because changing a gate changes how frequently positive and negative intermediate results occur. An argument that relied only on parity’s symmetry would leave both of them open.

In the idealised training rule, we take the sign of the **population gradient**, which averages over inputs and, for RL, the model’s sampled working. With uniform initial attention and a sufficiently large step size, a single update brings attention throughout the tree as close as desired to the target pattern. For parity, we can also follow a sequence of smaller sign updates. The two relevant positions gain attention together and approach one half each. The one-update result describes when informative directions are available. Estimating those directions from examples is a separate cost. [RL update and guarantee, Section 3.1](https://arxiv.org/html/2511.17852v3#S3.SS1) · [The three Boolean functions, Section 4](https://arxiv.org/html/2511.17852v3#S4)

## Why a full solution can teach one level at a time

Now give SFT a complete, correct solution for every input. Every one of the fifteen multiplications in a sixteen-bit example has a label from day one. During training, let the transformer predict each sign by taking the more likely output, then feed its predictions into the next level. This last choice is called training **without teacher forcing**. After generation we compare its predictions with the labels in the solution.

At the bottom of the tree, this works much like the first line of the hand calculation. The transformer sees the real input signs, and the label is the product of the appropriate two. At the next level, the model may be holding two positive numbers while the solution sheet says the product should be negative. On another input it may see the same two numbers and a positive target. Before the first-level values carry the right information about the original input, the fixed target can give an unreliable indication of which positions to attend to.

Once the first level is correct, a change takes place without our touching a single label. The second level starts to receive inputs that match the working from which its labels were calculated. Its gradient can now identify the right pairs. Learning those pairs in turn makes the third level’s inputs reliable. Under the separation condition, the SFT guarantee brings attention arbitrarily close to the target pattern within as many sign-gradient updates as there are levels. The training set contains the entire calculation throughout. Its order of learnability arises from the model reading its own output. [SFT guarantee and learning dynamics, Sections 3.2–3.3](https://arxiv.org/html/2511.17852v3#S3.SS2)

In the schematic below, the two models solve the same sixteen-bit parity problem. Advance to the first update and look at the four nodes on level two. Those multiplications already receive useful feedback from the process verifier. Watch when they first receive it under SFT.

{% include blog/learning-dynamics.liquid %}

### What that looks like in the experiment

We chose sixteen relevant positions out of twenty and sampled 50,000 random inputs. The most revealing measurement here is the sign of each proposed attention update. Each column in the plots corresponds to a value the model needs to produce. Reading down a column tells you which earlier positions the update would favour. If you know the hidden pairings, you can compare the proposed changes with the actual wiring.

<figure class="gradient-comparison">
  <div class="gradient-panels">
    <div>
      <strong>RL with process rewards</strong>
      <a href="{{ '/assets/img/blog/sparse-boolean/rl-gradient.png' | relative_url }}"><img src="{{ '/assets/img/blog/sparse-boolean/rl-gradient.png' | relative_url }}" width="500" height="1086" loading="lazy" alt="RL at initialisation. White cells identify relevant source positions across the tree wherever there are competing inputs. Open full-size plot."></a>
    </div>
    <div>
      <strong>SFT without teacher forcing</strong>
      <a href="{{ '/assets/img/blog/sparse-boolean/sft-gradients.png' | relative_url }}"><img src="{{ '/assets/img/blog/sparse-boolean/sft-gradients.png' | relative_url }}" width="1760" height="1174" loading="lazy" alt="SFT gradient signs at iterations zero, one and two. Active columns shift from the first level to the second and then the third. Open full-size plot."></a>
    </div>
  </div>
  <figcaption>White cells mark increases in attention logits, black cells decreases, and grey cells zero updates. The columns are grouped by reasoning level. Select either plot to enlarge it. From <a href="https://arxiv.org/html/2511.17852v3#A4">Figures 5b and 6 of our paper</a>.</figcaption>
</figure>

With process rewards, the pattern of increases already picks out the relevant positions wherever there are competing connections, across the tree at initialisation. The supervised run looks different. At initialisation its nonzero updates are confined to the first level. In the subsequent snapshots the next groups of connections become visible in order. Looking only at final answers after training would throw away exactly the information that distinguishes these two runs. [Numerical experiment, Appendix D](https://arxiv.org/html/2511.17852v3#A4)

## Change what the model gets to see

There is a simple way to test this account. Keep the supervised labels and change the inputs used during training. With **teacher forcing**, we feed the correct first-level products to the second level, the correct second-level products to the third, and so on. Revisit the six-sign example. The final multiplication now sees −1 and +1, and the target on the answer sheet is −1. Input and target agree about which multiplication is being taught. In our setting, this gives supervised learning an informative gradient across levels in the same update.

We can do the converse experiment on paper. Keep an RL update, but make its intermediate rewards compare each output with the original, fixed solution. If the model has written two positive numbers in our example, it now gets credit for replying −1. The verifier has lost the ability to distinguish a correct continuation of incorrect working from a fresh mistake. In a two-step parity analysis, changing the reward in this way can make RL learning proceed in stages too. The name of the optimiser alone tells you too little to predict the order of learning. [Teacher forcing, Appendix B](https://arxiv.org/html/2511.17852v3#A2) · [Fixed-reference rewards, Appendix H](https://arxiv.org/html/2511.17852v3#A8)

What if the verifier checks only the final answer? Imagine making two sign errors on separate branches. The errors can cancel when the branches are multiplied, leaving a correct final sign and two faulty pieces of working. The paper gives a more general reason why the signal can be weak for parity. Across a family of different parity targets, the final-reward gradient can vary very little with the choice of target. An update that looks almost the same for many different hidden subsets offers little guidance about which subset this particular model should learn. [Final-reward bound, Proposition 3.2](https://arxiv.org/html/2511.17852v3#S3.SS1)

## What I’d look for in a reasoning trace

In a comparison of fine-tuning methods, I would want to see one training example on which the model makes an early error. What does the next step receive as input? Who decides whether that step was correct? Could the same continuation earn credit on one run and lose it on another because the preceding working was different? In this problem, those details are enough to change which attention weights can learn on the first update. They are also details we can record in experiments on larger models.

The tree makes the verifier’s job unusually easy. We know exactly which two values a step should use and can work out their product even after a mistake. We also gave the transformer a suitable gate, an attention mask and noise-free feedback. A verifier reading a mathematical argument in ordinary language has a harder decision. An earlier line might contain a numerical slip from which the argument can proceed coherently, or it might introduce an undefined quantity that makes the next line impossible to judge.

That leaves a question I would take from Boolean functions back to language models. When a verifier awards credit after an error, **what calculation has it actually checked?** In the six-sign example, we can point to the two numbers on the page and answer exactly. Finding cases in real reasoning traces where we can answer with the same precision would give us a way to test how far this mechanism carries.

**Paper.** Bochen Lyu, Yiyang Jia, Xiaohao Cai and Zhanxing Zhu. *Transformers with RL or SFT Provably Learn Sparse Boolean Functions, But Differently*. 43rd International Conference on Machine Learning, 2026. [ICML proceedings](https://proceedings.mlr.press/v306/lyu26d.html)
