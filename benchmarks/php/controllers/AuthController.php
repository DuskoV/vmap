<?php

namespace app\controllers;

use Yii;
use yii\web\Controller;
use yii\web\UnauthorizedHttpException;
use yii\filters\VerbFilter;
use app\models\User;
use app\models\LoginForm;

/**
 * AuthController handles user authentication: login, logout, registration,
 * and password reset flows.
 */
class AuthController extends Controller
{
    public $layout = 'auth';

    public function behaviors()
    {
        return [
            'verbs' => [
                'class' => VerbFilter::class,
                'actions' => [
                    'login' => ['POST'],
                    'register' => ['POST'],
                    'logout' => ['POST'],
                ],
            ],
        ];
    }

    /**
     * Authenticates a user with email and password.
     * Tracks failed attempts and blocks after 5 failures.
     */
    public function actionLogin()
    {
        $form = new LoginForm();
        if (!$form->load(Yii::$app->request->post()) || !$form->validate()) {
            return $this->render('login', ['model' => $form]);
        }

        $user = User::findByEmail($form->email);
        if (!$user || !$user->validatePassword($form->password)) {
            Yii::$app->security->incrementFailedAttempts(Yii::$app->request->userIP);
            $form->addError('password', 'Invalid email or password.');
            return $this->render('login', ['model' => $form]);
        }

        if ($user->status !== User::STATUS_ACTIVE) {
            $form->addError('email', 'Account is not active.');
            return $this->render('login', ['model' => $form]);
        }

        // Two-factor check
        if ($user->two_factor_enabled) {
            Yii::$app->session->set('2fa_user_id', $user->id);
            return $this->redirect(['two-factor']);
        }

        Yii::$app->user->login($user, $form->rememberMe ? 3600 * 24 * 30 : 0);
        Yii::$app->security->resetFailedAttempts(Yii::$app->request->userIP);

        return $this->goBack();
    }

    /**
     * Registers a new user account.
     * Sends verification email and creates a pending user record.
     */
    public function actionRegister()
    {
        $model = new User(['scenario' => 'register']);

        if ($model->load(Yii::$app->request->post())) {
            $model->status = User::STATUS_PENDING;
            $model->generateAuthKey();
            $model->generateVerificationToken();
            $model->setPassword($model->password);

            if ($model->save()) {
                Yii::$app->queue->push(new \app\jobs\SendVerificationEmail([
                    'userId' => $model->id,
                ]));

                Yii::$app->session->setFlash('success',
                    'Registration successful. Please check your email to verify your account.'
                );
                return $this->redirect(['login']);
            }
        }

        return $this->render('register', ['model' => $model]);
    }

    /**
     * Verifies email address using the token from the verification email.
     */
    public function actionVerify($token)
    {
        $user = User::findByVerificationToken($token);
        if (!$user) {
            throw new UnauthorizedHttpException('Invalid or expired verification token.');
        }

        $user->status = User::STATUS_ACTIVE;
        $user->verification_token = null;
        $user->save(false);

        Yii::$app->session->setFlash('success', 'Email verified. You can now log in.');
        return $this->redirect(['login']);
    }

    /**
     * Logs out the current user and destroys the session.
     */
    public function actionLogout()
    {
        Yii::$app->user->logout();
        return $this->goHome();
    }

    /**
     * Initiates password reset by sending a reset token via email.
     */
    public function actionRequestReset()
    {
        $email = Yii::$app->request->post('email');
        $user = User::findByEmail($email);

        if ($user && $user->status === User::STATUS_ACTIVE) {
            $user->generatePasswordResetToken();
            $user->save(false);

            Yii::$app->queue->push(new \app\jobs\SendPasswordReset([
                'userId' => $user->id,
            ]));
        }

        // Always show success to prevent email enumeration
        Yii::$app->session->setFlash('success',
            'If an account exists with that email, a reset link has been sent.'
        );
        return $this->redirect(['login']);
    }
}
